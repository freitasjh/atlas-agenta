# Review B (v2) — ADR-05: worker de retentativa da fila WhatsApp

Revisor independente B, modelo distinto do revisor A, sem acesso ao parecer dele. Esta é a **2ª passada**: a v1 reprovou com três achados (envio duplicado sob concorrência — bloqueante; filtro `.or()` com timestamp citado; `SELECT` sem `attempts < max_attempts` no banco). O escopo re-revisado é o commit de correção `0431f40` ("fix: claim atomico na drenadora de retentativa WhatsApp") sobre o commit original `a1ffff4`. Dois arquivos mudaram no fix: a nova migration `20250223097000_fn_claim_retry_batch.sql` (estado `enviando` + RPC `whatsapp_claim_retry_batch`) e a drenadora `whatsapp-dispatch/index.ts` (passou a reivindicar via RPC). Foco desta passada: os três achados da v1 foram fechados e a correção não abriu nada novo.

**Watch for:** nada bloqueante. Os três achados da v1 foram corrigidos e verifiquei cada um contra o banco local rodando. A widening do índice de dedupe para incluir `enviando` foi a única mudança de schema com potencial de efeito colateral; tracei a interação com o `ON CONFLICT` do enqueue de `lembrete_d1` e confirmei empiricamente que o arbiter continua sendo inferido (sem regressão).

**Verdict**: APPROVED

## Visão de alto nível

A correção resolve a lacuna central da v1 do jeito certo: um estado intermediário de claim (`enviando`) mais uma RPC `whatsapp_claim_retry_batch` que trava as elegíveis com `FOR UPDATE SKIP LOCKED` e flipa `fila`→`enviando` numa transação. Duas invocações concorrentes jamais pegam a mesma linha — provei isso rodando dois claims em paralelo contra uma única linha elegível: exatamente um venceu, o outro voltou vazio. O índice de dedupe só impedia linha duplicada; agora a mesma linha também não é enviada duas vezes. O critério de aceite #4 e a RNF04 (não duplicar efeito) ficam satisfeitos.

A RPC absorveu os outros dois achados de borda ao concentrar a elegibilidade no SQL: `attempts < max_attempts` e `next_attempt_at <= now()` (ou NULL) viram comparação SQL pura dentro do claim, então sumiu o filtro `.or()` com timestamptz citado (cuja interpretação no PostgREST era incerta — achado 2) e linhas no teto não ocupam mais slots do lote (achado 3). A drenadora não descarta nada em JS: só processa o que a RPC devolveu já reivindicado.

O reclaim/TTL fecha o risco que o próprio claim introduz — linha presa em `enviando` se a função cair no meio do envio. A RPC, no começo de cada passada, devolve à `fila` qualquer `enviando` cujo `last_attempt_at` seja mais velho que 5 min, sem mexer em `attempts`/`next_attempt_at`, então a mensagem reentra no fluxo normal de backoff/teto. Verifiquei: uma linha presa em `enviando` com carimbo velho foi reclamada e re-reivindicada na mesma passada.

A função SQL `whatsapp_process_retry_queue()` (estado: teto R16 + janela R17) não mudou no fix e continua correta. As invariantes da Fatia 1 na drenadora (service role, opt-in LGPD, suspensão por assinatura, instância conectada, PII mínima em log, isolamento por `tenant_id` da própria linha) seguem preservadas — o fix não as tocou.

<details>
<summary>Issues (0)</summary>

Nenhuma issue acionável. Os três achados da v1 foram corrigidos e verificados contra o banco local:

- **v1-#1 (bloqueante) — envio duplicado sob concorrência:** RESOLVIDO. Claim atômico `fila`→`enviando` via `FOR UPDATE SKIP LOCKED` na RPC. Provado por dois claims concorrentes disputando uma linha: só um venceu.
- **v1-#2 — filtro `.or()` com timestamp citado:** RESOLVIDO. Elegibilidade agora é SQL puro na RPC (`next_attempt_at <= now()` ou NULL); o filtro PostgREST ambíguo foi removido.
- **v1-#3 — `SELECT` sem `attempts < max_attempts` no banco:** RESOLVIDO. A RPC filtra `attempts < max_attempts` no SQL; linhas no teto não entram no lote.

</details>

<details>
<summary>Details</summary>

## Achado bloqueante da v1 — fechado e provado sob concorrência

A v1 apontou que `drainQueue` fazia `select(fila)` → `sendText()` → `update(enviado)` sem atomicidade: duas passadas sobrepostas (cron + QA manual, que a ADR prevê) podiam selecionar a mesma linha `fila` e chamar o provedor duas vezes. O fix move a seleção para a RPC `whatsapp_claim_retry_batch`, que numa transação trava as elegíveis com `FOR UPDATE SKIP LOCKED` e as flipa para `enviando`, retornando só as efetivamente reivindicadas. A drenadora passa a enviar exclusivamente o que a RPC devolveu.

Prova direta contra o banco local: inseri **uma** linha `fila` elegível e disparei **dois** claims concorrentes (dois backends psql em paralelo). Resultado — um claim retornou a linha, o outro retornou vazio:

```
claim A:            (vazio)
claim B:  race1
```

Sem o `SKIP LOCKED` ambos teriam retornado `race1`. O duplo-envio comum está eliminado.

## Reclaim/TTL — a contrapartida do claim, também provada

Introduzir `enviando` cria o risco de linha presa se a drenadora cair entre o claim e a resolução. A RPC trata isso no passo 0: devolve à `fila` todo `enviando` com `coalesce(last_attempt_at, created_at) < now() - 5min`, sem tocar `attempts`/`next_attempt_at`. Teste funcional com uma linha `enviando` de `last_attempt_at` 10 min no passado: foi reclamada e re-reivindicada na mesma chamada de `whatsapp_claim_retry_batch`. Nenhuma mensagem se perde — ou foi enviada, ou volta a ser elegível. Como `enviando` não é terminal, reentra no backoff/teto normalmente.

## Widening do índice de dedupe — sem regressão (tracei a fundo)

A única mudança de schema do fix com efeito potencial além do escopo é o `messages_dedupe_uidx` passar a cobrir `'enviando'` (antes `fila|enviado|entregue`). Isso é correto: uma linha reivindicada continua "viva" e bloqueia uma segunda linha com a mesma `dedupe_key`. O risco que investiguei: o enqueue de `lembrete_d1` (`20250223095000`) usa `ON CONFLICT (tenant_id, dedupe_key) WHERE status in ('fila','enviado','entregue')`, predicado que **não** inclui `enviando` e que não foi reescrito após a widening. Se o arbiter de índice parcial deixasse de ser inferido, o `INSERT` do cron D-1 quebraria.

Confirmei contra o banco que **não quebra**: o `ON CONFLICT WHERE` do enqueue (subconjunto) continua inferindo o índice parcial (superconjunto) — a inferência exige que o predicado do `ON CONFLICT` implique o predicado do índice, e `in ('fila','enviado','entregue')` implica `in ('fila','enviando','enviado','entregue')`. A chamada real `select whatsapp_enqueue_lembrete_d1();` roda limpa, e um `INSERT ... ON CONFLICT` com o predicado do enqueue chega até a checagem de FK (ou seja, o plano com o arbiter foi aceito; não houve "no unique or exclusion constraint matching"). O webhook de entrada (`enqueueReagendarRetorno`) nem usa `ON CONFLICT` — faz `insert` e trata `23505`, então a widening só o torna mais estrito de forma correta. Sem regressão.

## Estado × envio — conferência numérica do state machine

Teste funcional ponta-a-ponta das transições que a ADR exige, com dados semeados (apontamento no passado e no futuro, mensagens em estados variados):

```
process_retry_queue →  failed_max_attempts=1 | failed_janela_vencida=1 | eligible_to_send=1
estados após:  m3(attempts=3)→falha/max_attempts   m4(lembrete,appt passado)→falha/janela_vencida
claim_retry_batch →  reivindicou m1 (pronta) e m5 (reclaim de enviando preso);
                     NÃO pegou m2 (next_attempt_at no futuro), m3/m4 (já falha)
```

Bate com R15/R16/R17 e com o backoff acordado (5/15/45 min, fator 3, teto 3). `reagendar_retorno` corretamente **não** expira por janela (só teto) — decisão documentada no cabeçalho da `20250223096000`.

## Fronteiras de segurança e tenant — mantidas

A nova RPC é `security definer`, `set search_path = public, pg_catalog`, com `revoke all` de `public`/`authenticated`/`anon` — só a service role da drenadora invoca. Não recebe `tenant_id` de parâmetro; cada linha devolvida carrega o próprio `tenant_id` e a drenadora filtra customer/instância/tenant por ele. `config.toml` mantém `verify_jwt` default na `whatsapp-dispatch` (worker interno, fechado a anônimos). Nenhum segredo no SQL versionado nem no `cron.schedule`. Opt-in LGPD, suspensão por assinatura e instância conectada continuam conferidos antes de chamar o provedor; `to`/`text`/telefone nunca logados.

## Contraprova

- `npm run build` → `tsc -b` + `vite build` limpos (aviso de chunk > 500 kB é pré-existente do bundle, alheio a esta ADR).
- `npm run test` → `vitest run`, 32/32 verdes.
- Banco local (`supabase_db_atlas-agenda`, migrations `20250223090000`..`097000` aplicadas): `whatsapp_process_retry_queue()`, `whatsapp_claim_retry_batch()` e `whatsapp_enqueue_lembrete_d1()` executam limpas; concorrência de claim provada; reclaim/TTL provado; teto/janela/elegibilidade provados; inferência do arbiter do `ON CONFLICT` do enqueue confirmada sob o índice widened.
- `deno check` da `whatsapp-dispatch` não executável aqui (sem binário Deno local) — fica para o QA (ADR-07), como instruído. O QA deve exercitar a drenadora ponta-a-ponta em mock e confirmar o caminho de envio (o disparo real pela Evolution depende de instância pareada, como na Fatia 1).

</details>
