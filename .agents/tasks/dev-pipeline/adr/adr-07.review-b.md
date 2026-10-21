# Revisor B — ADR-07 (verificação consolidada da Fatia 2 do WhatsApp)

ADR-07 não entrega código de feature: é o gate de verificação de ponta-a-ponta das ADRs 01–06
(schema + cron + webhook de entrada + lembrete + retentativa + frontend). Como revisor B
independente, revisei o diff consolidado da fatia contra `origin/master` e rodei a contraprova
exigida (build/typecheck/test + `deno check` das Edge Functions + `supabase db reset` + exercício
das funções/invariantes no banco real local). Não li o parecer do revisor A nem o veredito
agregado.

**Watch for:**
- Casamento resposta→agendamento compara telefone só por DDI-BR, sem reconciliar o **9º dígito**
  do celular brasileiro. `remoteJid` da Evolution frequentemente chega sem o 9; `customers.phone`
  costuma estar com ele. Equality pode errar um match legítimo (R8). (likely)
- `whatsapp-dispatch` (envio físico da fila) **não tem job de cron registrado** — só o SQL
  `whatsapp_process_retry_queue()` (que não envia) é agendado. No hosted a drenadora depende de
  invocação externa (pg_net) que esta fatia não versiona; hoje a fila só drena por chamada manual
  (QA). É decisão documentada, mas o lembrete D-1 "sozinho" não envia sem esse gancho. (confirmed)

**Veredito: APROVADO** — nenhum bloqueador. As duas observações acima são de robustez/entrega
operacional, já previstas no escopo/§7 do PRD como ajustáveis; não violam fronteira nem quebram
critério de aceite verificável nesta fatia.

## Panorama

A fatia resolve o problema central (confirmação interativa D-1) com uma fronteira de segurança
bem desenhada: o webhook de entrada é a única superfície pública e segue ordem rígida
autenticidade → schema → idempotência → resolução/efeito, com `tenant_id` sempre resolvido pela
instância e nunca pelo payload. A idempotência de entrada é travada por índice único no banco
(`webhook_events (source, external_event_id)`), não só por checagem na aplicação — verifiquei a
colisão ao vivo. O write de `webhook_events` é vedado ao cliente por ausência de policy de
INSERT/UPDATE/DELETE sob RLS, o que impede forjar confirmação.

O caminho de envio foi uniformizado: tanto o lembrete D-1 (cron) quanto o retorno de reagendamento
(webhook) nascem em `fila` e são drenados por um worker com claim atômico (`FOR UPDATE SKIP
LOCKED` + estado `enviando` + TTL de reclaim). A separação estado-SQL (teto/janela) × envio-Deno
mantém o segredo da Evolution fora do SQL versionado. O backoff e o teto estão corretos; a janela
útil do lembrete expira, e o retorno de reagendamento deliberadamente não expira.

O frontend é cirúrgico e determinístico: o selo "confirmado pelo cliente" depende só de
`confirmed_via === 'cliente_whatsapp'`, a confirmação manual grava `manual`, e o enum
`messages.status` ganhou `enviando` nos tipos/zod para o `.parse()` do histórico não derrubar a
lista. Segredos não aparecem no bundle.

## Contraprova executada (resultado)

- `npm run typecheck` e `npm run build`: **limpos** (bundle gerado, só o aviso pré-existente de
  chunk > 500 kB).
- `npm run test`: **32 testes, 2 arquivos, todos passando**.
- `deno check` de `whatsapp-inbound/index.ts` e `whatsapp-dispatch/index.ts`: **limpos** (com
  `--node-modules-dir=auto` para resolver a dep transitiva `@supabase/realtime-js`; sem isso o
  check falha por resolução de dependência — limitação de ambiente, não erro de tipo no código).
- `supabase db reset` (Docker disponível): **todas as 24 migrations aplicam, exit 0**. O caminho
  condicional do pg_cron não quebrou o reset local.
- Verificação no banco real: as 3 funções (`whatsapp_enqueue_lembrete_d1`,
  `whatsapp_process_retry_queue`, `whatsapp_claim_retry_batch`) existem e executam limpas;
  `messages_status_check` inclui `enviando`; `messages_dedupe_uidx` cobre
  `fila/enviando/enviado/entregue`; `webhook_events` tem RLS habilitado e **só** policy de SELECT
  para `admin`.
- Invariantes exercitadas com dado semeado: R7 (2ª gravação do mesmo `external_event_id` barrada
  pelo índice único), R9 (`update status+confirmed_via` resulta em `confirmado`/`cliente_whatsapp`
  com `confirmed_at` carimbado pelo trigger), R13 (transição `cancelado→confirmado` barrada pelo
  trigger).
- Limpeza: removi os artefatos temporários do `deno check` (`deno.lock` na raiz;
  `supabase/functions/node_modules`). Nenhuma mudança fora de `.agents/`. `supabase/functions/.env`
  permanece gitignored (não li valores de segredo).

## Issue summary

<details>
<summary>Issues (4)</summary>

1. **9º dígito no casamento de telefone** (likely) — `matchAppointment` compara
   `normalizePhoneForEvolution(sender)` com `normalizePhoneForEvolution(customer.phone)`, mas o
   helper só aplica DDI-BR; não reconcilia a presença/ausência do 9º dígito do celular. Um
   `remoteJid` sem o 9 (comum na Evolution) não casa com `phone` armazenado com o 9 → R8 pode
   falhar silenciosamente (`ignorado`). Ação: no QA da ADR-07, exercitar explicitamente um número
   com e sem o 9º dígito; se divergir, prever a dupla-forma no casamento (não bloqueia a fatia,
   mas registrar como dívida conhecida).

2. **Drenadora sem gancho de cron** (confirmed) — `pg_cron_setup` agenda
   `whatsapp_process_retry_queue()` (SQL, não envia) e `whatsapp_enqueue_lembrete_d1()`, mas
   **nada** agenda a Edge Function `whatsapp-dispatch` que de fato envia. No ambiente local/atual
   a fila só drena por invocação manual. Ação: confirmar no QA que o roteiro invoca a drenadora
   manualmente (como a ADR-07 prevê) e registrar que o gancho pg_net→dispatch no hosted é trabalho
   de operação/fase seguinte, fora do SQL versionado desta fatia.

3. **`verify_jwt` default de `whatsapp-dispatch` vs. invocação por cron** (possible) —
   `config.toml` mantém `whatsapp-dispatch` com `verify_jwt` default (true), fechando-a a chamadas
   anônimas (correto). Mas isso implica que o cron no hosted precisa apresentar um bearer válido
   (service role) via pg_net — contrato que não é exercitável localmente. Ação: no QA, documentar
   que a invocação autenticada não foi exercitada ao vivo (sem pg_net local) e fica só verificada
   estaticamente.

4. **Janela do lembrete expira só em `fila`, não em `enviando`** (possible) —
   `whatsapp_process_retry_queue()` expira `lembrete_d1` vencido com `where status='fila'`. Uma
   linha reivindicada presa em `enviando` só volta a ser elegível à expiração após o reclaim por
   TTL (5 min). O TTL cobre o caso, então o efeito é no máximo um atraso curto; não é perda. Ação:
   nenhuma obrigatória; só confirmar no QA que o reclaim devolve a `fila` e a passada seguinte
   expira.

</details>

<details>
<summary>Details</summary>

### Idempotência de entrada e barreira de escrita (R7/R18) — verificadas no banco

A trava real de R7 não é a checagem na função, é o índice único
`webhook_events (source, external_event_id)`. A função grava `recebido` **antes** de qualquer
efeito e, no `23505`, responde `duplicado` sem reprocessar. Semeei um evento e tentei duplicar: a
2ª inserção falhou com `duplicate key value violates unique constraint
"webhook_events_dedupe_uidx"`. R18 confirmado por introspecção: `relrowsecurity = t` e a única
policy é `webhook_events_select_admin` (SELECT). Sem policy de write, qualquer INSERT/UPDATE do
papel `authenticated` é negado — não há como o cliente forjar um evento de confirmação.

Um detalhe elegante: a FK composta `(tenant_id, appointment_id) → appointments (tenant_id, id)`
garante no banco que um evento só liga a agendamento do mesmo tenant, reforçando R12 além da
lógica da aplicação.

### R13 e o errcode do trigger — handling do webhook está correto

`applyConfirm` captura `error.code === "23514"` para tratar transição inválida sem quebrar.
Confirmei que o trigger `appointments_validate_transition()` levanta a exceção com
`using errcode = 'check_violation'`, que é exatamente SQLSTATE `23514`. A mensagem textual que o
psql mostra ("cancelado é um estado final…") é cosmética; o código por baixo é o que o cliente JS
recebe. Logo o caminho R13 do webhook (`confirmar` para agendamento já cancelado → `processado`
com `failure_reason='transicao_invalida'`, sem throw) funciona como projetado. Exercitei a
transição `cancelado→confirmado` e ela é barrada.

### Claim atômico da fila — a correção de review da ADR-05 está materializada

`messages_dedupe_uidx` agora cobre `fila/enviando/enviado/entregue` (verifiquei o `indexdef` no
banco), então uma linha reivindicada (`enviando`) continua "viva" para a unicidade — ninguém
insere segunda linha com a mesma `dedupe_key` enquanto a primeira está em voo. O
`whatsapp_claim_retry_batch` faz reclaim por TTL de `enviando` preso, trava elegíveis com
`FOR UPDATE SKIP LOCKED` e flipa `fila→enviando` numa transação. A drenadora Deno sempre move o
claim de saída (`enviado` / `fila` com backoff / `falha`). O risco de envio duplicado sob duas
invocações concorrentes (cron + QA manual, previsto pela própria ADR) está fechado no banco, não
em JS.

### Casamento por telefone (R8) — a lacuna do 9º dígito

Este é o ponto de maior fragilidade real da fatia. `matchAppointment` carrega os `customers` do
tenant com opt-in e compara `normalizePhoneForEvolution(c.phone)` com o remetente normalizado. O
helper (`evolution-adapter.ts`) só trata DDI-BR por comprimento: 10/11 díg → prefixa `55`; 12/13
com `55` → mantém. Ele **não** adiciona nem remove o 9º dígito de celular. No Brasil, o
`remoteJid` da Evolution para celulares costuma vir **sem** o 9 (12 díg: `55` + DDD + 8), enquanto
o cadastro guarda **com** (13 díg). Nesse caso a igualdade falha e o evento vira `ignorado` — uma
confirmação legítima do cliente não marca a agenda, que é justamente o valor de negócio da fatia.

Não é bloqueador porque (i) o formato exato do `remoteJid` v2.3.7 é um ponto aberto que a ADR-07
manda confirmar no QA, e (ii) a normalização está explicitamente documentada como defesa em
profundidade. Mas o QA desta fatia **precisa** exercitar um número com e sem o 9 para não dar a
fatia por boa com um casamento que erra na maioria dos celulares reais.

### Suspensão por assinatura e opt-in — cobertos nos dois caminhos

O webhook suspende efeito de negócio quando `subscription_status` é `bloqueado`/`cancelado`
(`assinatura_suspensa`, `ignorado`). O lembrete D-1 filtra `subscription_status not in
(...)` + `whatsapp_opt_in = true` + instância `conectado` + cliente `active`. A drenadora
reconfere opt-in e assinatura antes de chamar o provedor (opt-in ausente → falha terminal;
assinatura suspensa → backoff, não terminal, porque é transitório). Consistente com a disciplina
da Fatia 1.

### Frontend — determinístico e sem PII

`ClientConfirmedBadge` só renderiza com `status==='confirmado' && confirmed_via==='cliente_whatsapp'`,
usa `role="img"` + `aria-label` (distinção nunca por cor), reusa o token `--status-confirmado` e
não entra na ordem de tab (o alvo focável segue o `<button>`). `useChangeAppointmentStatus` grava
`confirmed_via='manual'` ao confirmar pela UI — a origem é determinística dos dois lados. O enum
`messages.status` ganhou `enviando` em `types/domain.ts`, no zod do histórico e nos mapas de
label/classe/hint de `lib/whatsapp.ts` — sem isso o `.parse()` do histórico derrubaria a lista
quando uma linha estivesse em claim. Os rótulos do histórico (`title`
"Aguardando reenvio automático"/"Falhou após várias tentativas") são derivados do estado, sem PII.
A verificação visual (contraste, foco, mobile, PII em tela) é do QA no step seguinte, como a ADR
determina — não subi dev server aqui.

### Segredos (R20)

`grep` no `dist/` por `service_role|WHATSAPP_WEBHOOK_SECRET|EVOLUTION_API_KEY|SUPABASE_SERVICE`:
nada. `.env.example` lista as chaves com valores vazios e alerta contra `VITE_*`. A drenadora e o
webhook só leem segredo de `Deno.env` no servidor. `whatsapp-inbound` é a única com
`verify_jwt=false` em `config.toml`, com justificativa (autenticidade por segredo compartilhado em
tempo constante, não GoTrue).

</details>
