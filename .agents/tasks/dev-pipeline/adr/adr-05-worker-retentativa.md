# ADR-05 — Worker de retentativa (cron) com backoff/limite e janela útil

**Status:** proposto
**Escopo:** dados (função SQL agendada + agendamento via pg_cron da ADR-02)
**Depende de:** adr-01 (campos de retentativa), adr-02 (infra pg_cron)

## Contexto

RNF04 pede uma fila de retentativa: uma falha temporária de envio não pode perder a mensagem. A
Fatia 1 deixa `messages` em `fila` quando o `handleSend` insere, e marca `enviado`/`falha` no ato;
não há reprocessamento. A Fatia 2 introduz mensagens que nascem em `fila` sem envio imediato: o
`lembrete_d1` (ADR-04) e o `reagendar_retorno` (ADR-03). Alguém precisa **drenar a fila**, enviar
pela Evolution, e reprocessar falhas temporárias com backoff e limite.

Tensão de arquitetura a resolver: o **envio físico** usa o adapter Evolution (Deno/Edge Function),
mas a ADR-02 decidiu cron por **função SQL**. Uma função SQL `security definer` não fala HTTP com a
Evolution de forma limpa sem `pg_net` + segredo embutido (o que a ADR-02 evitou).

### Decisão dos pontos abertos do PRD §7

- **Parâmetros de backoff:** base 5 min, fator 3, `max_attempts=3` (default da coluna). Tentativas
  em ~5min, ~15min, ~45min após a falha. `next_attempt_at = now() + base * pow(fator, attempts)`.
- **Mecanismo de envio:** ver Decisão abaixo (dois modos, o coder escolhe o viável no ambiente).

## Decisão

O worker tem duas responsabilidades separáveis — **elegibilidade/limite/janela (SQL puro)** e
**envio físico (Evolution)** — e esta ADR as desacopla para manter a ADR-02 (cron SQL) honesta:

1. **Função SQL `whatsapp_process_retry_queue()`** (`security definer`, agendada por
   `atlas_retry_queue` a cada 5 min) cuida de tudo que é **estado/dados**, SEM falar com a Evolution:
   - **Limite N (R16):** `update messages set status='falha', failure_reason='max_attempts' where
     status='fila' and attempts >= max_attempts`.
   - **Janela útil (R17):** para `lembrete_d1` cujo agendamento já passou de `starts_at`, `update
     ... set status='falha', failure_reason='janela_vencida'` (join por `appointment_id`; não
     reenviar lembrete de horário que já passou). Aplicar análogo a `reagendar_retorno` se fizer
     sentido (um retorno de reagendamento muito atrasado também pode expirar — decisão do coder,
     documentar).
   - Deixa em `fila` (elegível) só o que tem `next_attempt_at <= now()` e `attempts < max_attempts`
     e janela válida.
   - Esta parte é 100% testável sem scheduler e sem rede (`select whatsapp_process_retry_queue();`).

2. **Envio físico:** o worker SQL **não** envia pela Evolution. O envio das mensagens elegíveis é
   feito pela trilha Deno existente. Decisão para esta fatia, priorizando o que roda local sem
   segredo no SQL:
   - **Opção escolhida (A):** uma Edge Function drenadora `whatsapp-dispatch` (nova, pequena) que
     seleciona `messages status='fila' and next_attempt_at<=now() and attempts<max_attempts`
     (service role), para cada uma renderiza o texto (reusa `resolveRenderedText`/`render.ts` da
     Fatia 1) e chama o adapter; no sucesso `status='enviado'`+`provider_message_id`; no erro
     incrementa `attempts`, carimba `last_attempt_at=now()`, calcula `next_attempt_at` com o backoff
     e mantém `fila` (R15). Essa função é invocada periodicamente. Em ambiente hosted, o cron pode
     chamá-la via `pg_net`; **se** `pg_net` não estiver disponível/local, a função é invocável
     manualmente (QA) e a parte SQL (limite/janela/backoff elegibilidade) cobre a lógica testável.
   - **Nota de escopo:** o objetivo da fatia é a **lógica** de retentativa provada (backoff,
     limite, janela) + o caminho de envio existir. O disparo real ponta-a-ponta pela Evolution
     depende de instância pareada (igual à Fatia 1, que verificou os 5 outcomes em mock e deixou o
     envio real com QR como não-exercitável sem celular). Registrar isso no QA (ADR-07).

   O coder pode, alternativamente, concentrar o envio reusando o `handleSend` já existente se isso
   sair mais simples; o que **não** pode mudar: backoff/limite/janela são do SQL testável, segredo
   da Evolution nunca entra no SQL do cron, e a idempotência de `dedupe_key` é preservada.

3. **Idempotência e PII:** o worker nunca reenvia o que já está `enviado`/`entregue` (índice parcial
   garante unicidade viva); logs sem telefone/texto; `failure_reason` técnico curto.

## Consequências

- Mensagens que nascem em `fila` (lembrete D-1, retorno de reagendamento) passam a ser efetivamente
  processadas, com backoff e teto de tentativas, sem perder a janela útil.
- Introduz possivelmente uma 2ª Edge Function (`whatsapp-dispatch`); se o coder reusar `handleSend`,
  não. A fronteira de segredo (Evolution só no servidor) é mantida nos dois caminhos.
- A latência de entrega de `reagendar_retorno` e do lembrete é de até 1 ciclo (5 min) — aceito.

## Arquivos afetados

- `supabase/migrations/20250223096000_fn_retry_queue.sql` (novo — função SQL de
  limite/janela/backoff-elegibilidade + opcional `cron.schedule` condicional).
- (Opção A) `supabase/functions/whatsapp-dispatch/index.ts` (novo — drenador que envia pela
  Evolution e aplica backoff no erro), reusando `render.ts`/`evolution-adapter.ts` da Fatia 1.
- `supabase/config.toml` se a função drenadora precisar de config.

## Critérios de aceite testáveis (desta ADR)

1. **R15 backoff:** uma `messages` em `fila` que "falhou" (simular `attempts=1`,
   `next_attempt_at` no passado) é reconsiderada; ao incrementar, `next_attempt_at` avança pelo
   backoff e `attempts` cresce.
2. **R16 limite:** `attempts >= max_attempts` → `status='falha'`, `failure_reason='max_attempts'`,
   não reprocessada. (Provável via `select whatsapp_process_retry_queue();`.)
3. **R17 janela:** `lembrete_d1` em `fila` cujo agendamento já passou de `starts_at` →
   `status='falha'`, `failure_reason='janela_vencida'`, não enviado.
4. O que está `enviado`/`entregue` nunca é reprocessado.
5. `supabase db reset` aplica limpo (com e sem pg_cron); re-apply idempotente; nenhum segredo no SQL.
6. `deno check` da função drenadora (se criada) + `npm run build` limpos.

## Verificação

- `supabase db reset`, inserir linhas de `messages` em `fila` em estados variados (attempts no
  limite; lembrete com `starts_at` passado; elegível normal), `select
  whatsapp_process_retry_queue();` e inspecionar transições para `falha`/elegibilidade. Exercitar a
  drenadora (se criada) em mock para o caminho de envio.
- `npm run build` + `deno check` (se houver função nova).
