# ADR-04 — Edge Function `whatsapp` (adapter Evolution atrás de porta, mock, operações `pair`/`send`)

- **Status:** proposto
- **Escopo:** dados (backend serverless)
- **Depende de:** ADR-02 (`whatsapp_instances`) e ADR-03 (`messages` + índice único de idempotência). É a **primeira Edge Function do projeto**.

## Contexto

A conexão e o envio precisam de uma superfície **privilegiada no servidor**: deriva `tenant_id`/`role` do JWT (nunca do payload), escreve `messages`/`whatsapp_instances` com service role (único caminho de escrita de `messages`), confere opt-in LGPD antes de chamar o provedor, aplica idempotência e esconde o adapter Evolution. O usuário pediu **mock agora, real depois** (msgs 11/12): a integração real fica desacoplada atrás de uma porta, selecionável por env `EVOLUTION_MODE`. O segredo/token da Evolution e a service role **nascem no servidor**, nunca no bundle. Não há webhook de entrada nesta fase.

Decisão de forma (análises de dados §5 e frontend §4.1): **uma** Edge Function `whatsapp` com campo `action` (`pair` | `send`) em vez de duas funções — o adapter e a seleção mock/real ficam num ponto só; o frontend só manda `action`.

## Decisão

Criar a Edge Function Deno em `supabase/functions/whatsapp/index.ts` (padrão Supabase `functions/<nome>/index.ts`), com módulos de apoio no mesmo diretório para manter a função coesa e testável:

- `supabase/functions/whatsapp/index.ts` — entrypoint HTTP: CORS/headers, parse do body, roteamento por `action`, autenticação/derivação de tenant, tratamento de erro por condição, respostas pt-BR.
- `supabase/functions/whatsapp/schemas.ts` — schemas **zod** do payload de entrada (`{ action: 'pair' }` e `{ action: 'send', template, customerId, customer_id, appointmentId? }`) e dos DTOs de resposta. Payload é dado não confiável: validar antes de usar; qualquer `tenant_id` no body é ignorado.
- `supabase/functions/whatsapp/evolution-adapter.ts` — **porta** (interface) `EvolutionAdapter` com `pair(instanceName): { qrCodeBase64, status }` e `sendText({ instanceName, to, text }): { providerMessageId }`; impl **mock** (QR fake base64, `providerMessageId` fake, latência simulada, zero rede). Seleção por `EVOLUTION_MODE` (`mock`|`real`, default `mock`); a impl `real` é um stub que lança "não implementado" nesta fase (ou é omitida) — só o mock roda. `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` só seriam lidas pela impl real.

Autenticação e derivação de tenant:
1. Lê o JWT do header Authorization, resolve `auth.uid()`.
2. Deriva `tenant_id` e `role` de `profiles` **no servidor** (service role), nunca do payload.
3. Autoriza por papel: `pair` exige `admin`; `send` exige `admin|receptionist|professional`. Papel insuficiente → 403 pt-BR.

Operação `pair`:
- Garante a linha `whatsapp_instances` do tenant (upsert por `tenant_id`, respeitando o unique); seta `connection_status='aguardando_qr'`; chama `adapter.pair(...)` (mock) → QR fake; evolui para `conectado` + `last_connected_at=now()`. Os três estados devem ser **observáveis** pela UI (a transição `aguardando_qr → conectado` pode ser por segunda leitura/poll — o mock torna determinístico). Saída: `{ connection_status, qr_code_base64?, last_connected_at? }`. **QR não é persistido.**

**Contrato de fio (DONO = esta ADR).** `action` usa os verbos `pair` | `send`; o payload de `send` usa **camelCase** (`customerId`, `appointmentId?`, `template`), alinhado ao consumidor (ADR-06) e à análise de frontend. Qualquer `tenant_id` no corpo é ignorado. Se este contrato mudar, atualizar os zod schemas do frontend e os docs de análise.

**Shape de resposta de `send` (DTO único).** TODAS as condições de negócio de `send` — `sent`, `duplicate`, `opt_out`, `not_connected`, `send_failed` — retornam o DTO `{ outcome, message_id, status, provider_message_id? }` **no corpo**, mesmo quando o status HTTP não é 200 (200 sent/duplicate, 422 opt_out, 409 not_connected, 502 send_failed). Assim a UI valida sempre com zod e decide a mensagem pelo `outcome`, sem depender do canal de erro do `functions.invoke`. Apenas erros de infra/auth (400/401/403/404/500) usam `{ error, issues? }` e caem no canal de erro do invoke.

**Outcomes.** `send_failed` (provedor recusou/falhou) é **distinto** de `not_connected` (instância desconectada): conflacioná-los faria o 502 ser traduzido na UI como "conecte o WhatsApp", escondendo a falha real. O enum `sendOutcomeSchema` carrega ambos e o mapa de erro do frontend (ADR-06) os traduz separadamente.

Operação `send` (ordem importa):
1. Valida schema (zod) → 400 + erros pt-BR; nada gravado.
2. Resolve o customer no tenant (service role, filtrando pelo `tenant_id` derivado). Inexistente/outro tenant → 404/403 pt-BR; nada gravado. **Cliente inativo (`active=false`, soft-delete) → 404 pt-BR; nada enviado** (coerente com a semântica de soft-delete).
3. **Opt-in (LGPD):** se `whatsapp_opt_in=false` → **não** chama o provedor; grava `messages` `status='falha'`, `failure_reason='opt_in_ausente'` (sem PII); devolve 422 + pt-BR. Esse registro de falha **não** entra no índice de dedupe (parcial exclui `falha`).
4. **Idempotência:** compõe `dedupe_key` e procura disparo vivo (`status in ('fila','enviado','entregue')`) com a mesma chave no tenant. Se existe → devolve o existente (200, `outcome:'duplicate'`) sem 2ª linha. Senão, insere `messages` `status='fila'` com `dedupe_key`; o índice único resolve a corrida (a 2ª invocação recebe violação de unique e relê a linha vencedora).
5. Envia via `adapter.sendText(...)` (mock). Sucesso → `update messages set status='enviado', provider_message_id=…`. Falha do provedor → `status='falha'` + `failure_reason` técnico curto (sem PII); 502 pt-BR.
- Saída: `{ outcome: 'sent'|'duplicate'|'opt_out'|'not_connected', message_id, status, provider_message_id? }` — contrato que a UI (ADR-06) valida com zod. **Se o contrato mudar, atualizar os zod schemas do frontend e os docs de análise.**

Supender disparo quando assinatura `bloqueado`/`cancelado`: registrar como invariante da função (checar status do tenant antes de enviar) — a UI já não chega a oferecer, mas a trava efetiva é no servidor.

Erros por condição (status + corpo + efeito em `messages`; logs sem PII). Infra/auth usam `{ error }`; condições de negócio de `send` usam o DTO `{ outcome, message_id, status, provider_message_id? }`:
- 400 payload inválido (`{ error, issues }`), 401 JWT inválido, 403 papel insuficiente / assinatura suspensa, 404 customer inexistente ou inativo, 500 inesperado — todos `{ error }`.
- 200 `outcome:'sent'`/`'duplicate'`; 422 `outcome:'opt_out'` (grava `falha`, `failure_reason='opt_in_ausente'`); **409 `outcome:'not_connected'`** (instância desconectada; nada enviado); 502 `outcome:'send_failed'` (grava `falha`, `failure_reason='provider_error'`) — todos no shape DTO de `send`.

> Nota de desvio registrada: o **409** (`not_connected`) foi adicionado à lista de status desta ADR de propósito — modela "instância não conectada" como condição de negócio com corpo DTO, não como erro de infra. QA não deve tratar como divergência.

Env/segredos: `.env.example` (ou um `supabase/functions/.env.example`) documenta `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_MODE` **sem valores** e **sem prefixo `VITE_`**. Nada de segredo no bundle do cliente.

## Consequências

- Primeira superfície privilegiada do projeto; concentra as invariantes caras (tenant do JWT, opt-in, idempotência, segredo fora do cliente) num ponto testável.
- O adapter atrás da porta mantém o envio testável sem rede; a impl real entra depois sem mexer na função nem na UI.
- Habilita os hooks de mutation da UI (ADR-06) via `supabase.functions.invoke("whatsapp", ...)`.
- Decisão durável (porta de adapter + contrato da function + idempotência no servidor) — candidata a promoção futura para `docs/` (não copiar agora).

## Arquivos afetados

- `supabase/functions/whatsapp/index.ts` (novo)
- `supabase/functions/whatsapp/schemas.ts` (novo)
- `supabase/functions/whatsapp/evolution-adapter.ts` (novo)
- `.env.example` (ou `supabase/functions/.env.example`) — adicionar placeholders de servidor, sem valores e sem `VITE_`

## Critérios de aceite testáveis (desta ADR)

Ambiente: `supabase functions serve` + Supabase local + `EVOLUTION_MODE=mock`.

- **A1.** `pair` com JWT de admin devolve QR fake e `whatsapp_instances` transita `desconectado → aguardando_qr → conectado` com `last_connected_at` preenchido; QR não persistido (CA-09, CA-14).
- **A2.** `send` com `whatsapp_opt_in=true` → `messages.status='enviado'` + `provider_message_id` fake; resposta `outcome:'sent'` (CA-10).
- **A3.** `send` com `whatsapp_opt_in=false` → provedor não chamado; `messages.status='falha'` + `failure_reason` sem PII; 422 pt-BR; nenhum `provider_message_id` (CA-11).
- **A4.** Reenvio idêntico (mesmo `template` + `appointmentId`/`customerId`, mesmo tenant) → deduplicado, nenhuma 2ª linha `enviado`, `outcome:'duplicate'`; o registro de `falha` por opt-in não trava tentativa futura legítima (CA-12).
- **A5.** `tenant_id` forjado no payload é ignorado; o tenant efetivo é o do JWT (CA-13).
- **A6.** Papel insuficiente (`pair` por não-admin) → 403 pt-BR (CA-08 no caminho da function).
- **A7.** `grep` no repositório/bundle não encontra token Evolution nem service role; `.env.example` só com placeholders sem valores e sem `VITE_` nos segredos de servidor (CA-20).
- **A8.** `grep` negativo por `cron`/agendador/worker e por chamada de rede real à Evolution — só o adapter mock (CA-18, CA-19).

## Lacuna de verificação (typecheck Deno)

`npm run build`/`npm run typecheck` cobrem **apenas** `src/` + configs do Vite (o `tsconfig` do app não inclui `supabase/functions`, que roda em Deno com imports `npm:`/`jsr:`). Portanto a corretude de tipos de `supabase/functions/whatsapp/*.ts` **não** é checada pelo pipeline de build atual, e `deno` não está instalado neste ambiente. A verificação de tipos/SQL desses arquivos fica **pendente para o QA** (rodar `deno check supabase/functions/whatsapp/*.ts` e exercitar a function via `supabase functions serve` com Supabase local). Até lá, a corretude dos arquivos Deno foi conferida por inspeção/`grep` apenas.
