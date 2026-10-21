# ADR-03 — Edge Function `whatsapp-inbound`: webhook de ENTRADA da Evolution

**Status:** proposto
**Escopo:** dados (nova Edge Function Deno + consumo das tabelas da ADR-01)
**Depende de:** adr-01 (`webhook_events`, `appointments.confirmed_via`, template `reagendar_retorno`,
campos de retentativa em `messages`)

## Contexto

Esta é a peça central e a maior superfície de risco: o **primeiro webhook de ENTRADA** do projeto.
A Evolution API chama uma URL pública (sem JWT de usuário) quando o cliente responde no WhatsApp. A
função precisa: verificar autenticidade, validar schema (zod), ser idempotente, resolver o tenant
**pela instância** (nunca pelo payload), casar a resposta a um agendamento e aplicar o efeito
(1=confirma / 2=mensagem de retorno) — tudo com PII mínima.

Fatos consumidos (ADR-04 Fatia 1, `supabase/functions/whatsapp/`):
- Padrão de Edge Function Deno: `Deno.serve`, `createClient(... SERVICE_ROLE_KEY ...)`,
  `corsHeaders`, respostas JSON pt-BR, logs sem PII, zod para dado não confiável.
- `evolution-adapter.ts` tem `normalizePhoneForEvolution()` (E.164-BR) reutilizável para normalizar
  o número do remetente antes de casar com `customers.phone`.
- `whatsapp_instances.evolution_instance_name` = `tenant-<tenant_id>` → é por aí que se resolve o
  tenant a partir da instância que recebeu o evento.
- `appointments_validate_transition()` carimba `confirmed_at` na transição para `confirmado`; o CHECK
  de transição levanta `check_violation` (23514) em transição inválida.
- `messages` escrita só por service role; idempotência de envio por `dedupe_key` (índice único
  parcial). O padrão de dedupe de `lembrete_d1` é `lembrete_d1:a:<appointmentId>`.

### Decisão de design dos pontos abertos do PRD §7 (resolvidos aqui)

- **Webhook como FUNÇÃO SEPARADA** (recomendação do PRD, confirmada): nova Edge Function
  `whatsapp-inbound`, **não** uma rota dentro de `whatsapp`. Razão: superfície pública **sem** JWT
  (a função `whatsapp` exige Authorization Bearer e resolve identidade por token; misturar as duas
  posturas de auth numa função só é frágil). `whatsapp-inbound` deve ser servida **sem** verificação
  de JWT do Supabase (`verify_jwt = false` em `supabase/config.toml` para essa função) — a
  autenticidade é feita pelo segredo compartilhado (abaixo).
- **Autenticidade = segredo compartilhado `WHATSAPP_WEBHOOK_SECRET`** (a Evolution v2.3.x não assina
  HMAC por padrão). A função exige o segredo num header combinado (ex.: `apikey` ou um header
  próprio `x-webhook-secret`) **e** compara em **tempo constante** (evitar timing). Sem match → 401,
  `webhook_events.status='rejeitado'`, nenhum efeito (R5). O segredo vive em env do servidor
  (`.env.example` ganha a chave vazia; valor real só em secrets) — nunca no bundle, nunca `VITE_`.
- **Formato do payload da Evolution** (contrato a confirmar na doc v2.3.7 — ver fontes). O evento de
  mensagem recebida é `messages.upsert` / `MESSAGES_UPSERT`, com shape aproximado:
  `{ event, instance, data: { key: { remoteJid, fromMe, id }, message: { conversation?: string,
  extendedTextMessage?: { text?: string } }, messageTimestamp? } }`. Decisões derivadas:
  - `external_event_id` = `data.key.id` (id da mensagem no WhatsApp) — chave de dedupe (R7).
  - `instance_name` = `instance` (topo do payload) → resolve o tenant.
  - `fromMe === true` → **ignorar** (eco da própria mensagem enviada; não é resposta do cliente).
  - texto = `data.message.conversation ?? data.message.extendedTextMessage?.text` (tolerar ambos).
  - telefone do remetente = parte antes de `@` em `remoteJid` → normalizar com
    `normalizePhoneForEvolution` para casar com `customers.phone` normalizado.
  - **O coder confirma os nomes exatos** contra o servidor real durante o QA (ADR-07) e ajusta o zod;
    o schema deve ser **tolerante** (campos opcionais) e validar o mínimo necessário, nunca executar
    conteúdo recebido.
- **Resposta "não entendi" (R11) = fora de escopo** (decisão): texto que não casa `1`/`2` é apenas
  registrado como `webhook_events.status='ignorado'`, `parsed_intent='nao_reconhecido'`, sem enviar
  nada de volta. (O mínimo pedido pelo PRD é ignorar; não enviar resposta automática reduz spam e
  superfície.)

## Decisão (fluxo da função)

Ordem rígida — **autenticidade → schema → idempotência → resolução/efeito** (nada de efeito antes
dos três primeiros):

1. Só `POST` (+ `OPTIONS` para CORS). Cria service client (SERVICE_ROLE_KEY).
2. **Autenticidade:** ler o segredo do header; comparar em tempo constante com
   `WHATSAPP_WEBHOOK_SECRET`. Sem match → gravar `webhook_events(status='rejeitado',
   failure_reason='auth')` **se** já houver `external_event_id` legível, senão só logar; responder
   `401`. Nenhum efeito (R5).
3. **Schema (zod):** parsear o corpo. Falhou → `400`, `webhook_events(status='rejeitado',
   failure_reason='schema')`, sem efeito (R6).
4. `fromMe === true` ou sem texto → `webhook_events(status='ignorado')`, `200` (nada a fazer).
5. **Idempotência:** inserir `webhook_events(source='evolution', external_event_id, instance_name,
   status='recebido', payload=<metadados sem PII>)`. Se o INSERT violar o índice único
   `(source, external_event_id)` (23505) → é reprocessamento: **parar antes de qualquer efeito** e
   responder `200` (R7). (Inserir cedo a linha de evento é o que garante a trava.)
6. **Resolver tenant pela instância:** `whatsapp_instances.evolution_instance_name = instance_name`
   → `tenant_id`. Não achou → `webhook_events(status='ignorado')`, `200` (R8, sem efeito, sem erro
   ao provedor). O `tenant_id` **nunca** vem do payload (R12/RNF03).
7. **Status de assinatura:** se o tenant está `bloqueado`/`cancelado`, não aplicar efeito de negócio
   (coerente com suspensão de disparos) → `ignorado`.
8. **Casar resposta → agendamento** (R8): dentro do tenant resolvido, achar o agendamento do
   `customer` cujo `phone` normalizado == remetente normalizado, com `status in
   ('pendente','confirmado')`, que teve `lembrete_d1` enviado (há `messages` com
   `template='lembrete_d1'` e `appointment_id` = candidato, status enviado/entregue), `starts_at` no
   futuro, escolhendo o `starts_at` **mais próximo**. Nenhum casa → `ignorado`, `200`.
9. **Interpretar o texto** (normalizar: trim, primeiro token; tolerar "1 confirmar"):
   - `1` → **confirmar** (R9): `update appointments set status='confirmado', confirmed_via=
     'cliente_whatsapp' where id=<casado> and tenant_id=<t>`. O trigger carimba `confirmed_at`.
     **Transição inválida é segura** (R13): se o agendamento já é `cancelado/concluido`, o trigger
     levanta `check_violation` (23514) — capturar, **não** quebrar, gravar
     `webhook_events(status='processado', failure_reason='transicao_invalida')` e seguir.
     Sucesso → `webhook_events(status='processado', parsed_intent='confirmar', appointment_id=<>)`.
     Nota de implementação: para gravar `confirmed_via` **junto** da transição sem brigar com o
     trigger (que roda em `before update of status`), o update faz `set status=..., confirmed_via=...`
     numa só instrução — o trigger só valida `status`; `confirmed_via` passa junto. Se `status` já
     for `confirmado` (reconfirmação), fazer `update ... set confirmed_via='cliente_whatsapp' where
     confirmed_via is distinct from 'cliente_whatsapp'` sem mudar status (não reentra no trigger).
   - `2` → **reagendar** (R10/R14): **não** altera `appointments.status`. Enfileira
     `messages(template='reagendar_retorno', customer_id, appointment_id, status='fila',
     dedupe_key='reagendar_retorno:a:<appointmentId>', payload=<sem PII>, attempts=0,
     next_attempt_at=now())` — mesma disciplina de opt-in e idempotência do `handleSend`. Respeitar
     **opt-in**: se `whatsapp_opt_in=false`, não enfileira (grava `messages status='falha',
     failure_reason='opt_in_ausente'` ou só registra em webhook_events — seguir o padrão da Fatia 1).
     `webhook_events(status='processado', parsed_intent='reagendar', appointment_id=<>)`.
   - outro → `webhook_events(status='ignorado', parsed_intent='nao_reconhecido')` (R11).
10. **PII mínima** (R19): `webhook_events.payload` e logs **não** guardam telefone, documento nem o
    texto cru. Guardar no máximo: `instance_name`, `parsed_intent`, um hash curto/omitido do
    telefone, timestamps. O texto digitado nunca é persistido em claro; o histórico mostra o
    rótulo derivado (ADR-06).
11. Respostas ao provedor: sempre `200` para eventos aceitos/ignorados (evitar reentrega infinita);
    `401`/`400` só para auth/schema. Corpo curto, sem PII.

## Consequências

- Primeira função pública sem JWT do projeto → exige `verify_jwt = false` no `config.toml` só para
  `whatsapp-inbound`; a autenticidade passa a depender inteiramente do segredo compartilhado.
- O enfileiramento de `reagendar_retorno` deixa a mensagem em `fila`; **quem envia de fato** é o
  worker de retentativa (ADR-05) ou, se o coder preferir, a própria função chama o adapter na hora
  (como o `handleSend`) e cai em `fila`→retentativa só no erro. Decisão: **enfileirar e deixar o
  worker enviar** mantém a função de entrada rápida e uniformiza o caminho de envio; aceitar que a
  entrega do retorno tem latência de até 1 ciclo do worker (5min). Registrar essa escolha.
- Isolamento multi-tenant preservado: tenant só pela instância; casamento restrito ao tenant (R12).

## Arquivos afetados

- `supabase/functions/whatsapp-inbound/index.ts` (novo)
- `supabase/functions/whatsapp-inbound/schemas.ts` (novo — zod do payload Evolution, tolerante)
- Reuso: importar `normalizePhoneForEvolution` de `../whatsapp/evolution-adapter.ts` (ou extrair o
  helper para um módulo compartilhado se o import cruzado incomodar o `deno check`).
- `supabase/config.toml` — `[functions.whatsapp-inbound] verify_jwt = false`.
- `.env.example` — acrescentar `WHATSAPP_WEBHOOK_SECRET=` (vazio).

## Critérios de aceite testáveis (desta ADR)

Testar com **payload simulado** (curl/post à função local servida), sem WhatsApp real:
1. **R5 autenticidade:** POST sem/errado o segredo → `401`; `webhook_events` fica `rejeitado` (ou
   ausente se o id não era legível); nenhum `appointments` muda.
2. **R6 schema:** POST com corpo fora do zod → `400`/`rejeitado`, sem efeito.
3. **R7 idempotência:** POST do mesmo `external_event_id` duas vezes → só UMA `webhook_events`; a 2ª
   não gera segunda confirmação nem segundo `reagendar_retorno`.
4. **R8/R12 casamento + isolamento:** com um `lembrete_d1` enviado e `starts_at` futuro, o telefone
   casa só o agendamento do tenant da instância; telefone presente em 2 tenants nunca confirma o do
   outro tenant.
5. **R9 confirma:** texto `1` → `appointments.status='confirmado'`, `confirmed_at` carimbado,
   `confirmed_via='cliente_whatsapp'`, `webhook_events.status='processado'`/`parsed_intent=confirmar`.
6. **R10/R14 reagendar:** texto `2` → status inalterado; uma `messages` `reagendar_retorno` em
   `fila` com dedupe próprio e sem PII no payload; `parsed_intent='reagendar'`.
7. **R11:** texto `abc` → `ignorado`/`nao_reconhecido`, sem efeito.
8. **R13 transição segura:** `1` para agendamento `cancelado` não quebra a função (sem 500);
   registra e segue.
9. **R19 PII:** `webhook_events.payload` e logs não contêm telefone nem o texto cru.
10. `deno check supabase/functions/whatsapp-inbound/index.ts` passa; `npm run build` do projeto
    permanece limpo.

## Verificação

- Servir funções local (`supabase functions serve` / script `dev:functions`), `supabase db reset`
  para popular um tenant + instância + agendamento + `lembrete_d1`, e exercitar os casos 1–9 por
  curl. Confirmar estados em `webhook_events`/`appointments`/`messages`.
- `deno check` da nova função + `npm run build`.

## Fontes

- Formato do evento de mensagem recebida da Evolution API (`messages.upsert` com `data.key`
  `{ remoteJid, fromMe, id }` e `message.conversation`): issues públicas do repositório
  EvolutionAPI/evolution-api (ex.:
  [#572](https://github.com/EvolutionAPI/evolution-api/issues/572),
  [#975](https://github.com/EvolutionAPI/evolution-api/issues/975)). Conteúdo resumido; o coder
  confirma os nomes exatos contra o servidor v2.3.7 no QA. Content was rephrased for compliance with
  licensing restrictions.
