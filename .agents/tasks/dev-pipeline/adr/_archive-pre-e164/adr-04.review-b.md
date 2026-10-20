# Parecer do Revisor B — ADR-04 (Edge Function `whatsapp`, adapter Evolution mock) — passo 2

- **Data:** 2026-10-18 20:21
- **Revisor:** B (independente; não viu o parecer do revisor A)
- **Escopo revisado:** ADR-04 completa = commits `800ba57` (codificação original) + `3b2ee60` (fix de contrato/outcomes). Arquivos: `supabase/functions/whatsapp/{index,schemas,evolution-adapter}.ts` + `supabase/functions/.env.example`. Bate com os "Arquivos afetados" da ADR.
- **Contraprova:** `npm run build` (`tsc -b && vite build`) → **OK** (5,36s, sem erros de tipo). `typecheck` é o mesmo `tsc -b`. Não há lint configurado no `package.json` (scripts: `dev`/`build`/`typecheck`/`preview`). `deno` não está instalado e o `tsconfig` só inclui `src` + configs do Vite — portanto **nenhum typecheck local cobre os arquivos Deno desta ADR**; essa lacuna está declarada na própria ADR e fica para o QA (`deno check`).

## Resumo

Esta é a **segunda passada** sobre a ADR-04. A primeira (ambos revisores) pediu NEEDS_CHANGES por divergência de contrato de fio e rotulagem de outcome. O commit `3b2ee60` endereçou os pontos: o schema agora é `discriminatedUnion("action", ["pair","send"])` com `customerId`/`appointmentId` em camelCase (alinhado ao consumidor ADR-06 e à `analysis-frontend.md`); `send_failed` virou outcome próprio, distinto de `not_connected`; **todas** as condições de negócio de `send` (`sent`/`duplicate`/`opt_out`/`not_connected`/`send_failed`) devolvem o DTO `{ outcome, message_id, status, provider_message_id? }` no corpo via `sendResponse()`, inclusive nos status não-200; a linha de `falha` por opt-in agora retorna `id` (`.select("id").single()`); o 409 `not_connected` ganhou nota de desvio explícita na ADR; cliente inativo (`active=false`) é bloqueado com 404. **Watch for:** só sobra a lacuna conhecida de typecheck Deno (não é regressão; QA cobre) e uma nota de sincronismo em doc de consumo (ADR-06 `pending`). Nenhum item bloqueante.

**Verdict**: APPROVED

## Visão de alto nível

O contrato de fio agora é único e consistente entre o dono (ADR-04/`schemas.ts`) e o consumidor (`analysis-frontend.md` §5, ADR-06): `action: "pair"|"send"` + camelCase. A quebra silenciosa de integração que a passada anterior previa (todo `invoke` caindo em 400) não existe mais — o `discriminatedUnion` casa exatamente o que a UI planejada manda.

A postura de segurança/multi-tenant segue sólida e fiel: `tenant_id`/`role` vêm sempre do JWT via `profiles` com service role, nunca do payload; um `tenant_id` forjado no corpo é descartado por não existir no schema (sem `.passthrough()`); a escrita de `messages`/`whatsapp_instances` só ocorre nesta função com service role, coerente com a ausência de policy de write na migration (RLS nega o cliente). Segredos ficam fora do bundle (grep no `dist/` limpo; `.env.example` sem valores e sem `VITE_`). O adapter é só mock (sem rede, sem cron), com stub `real` que falha claro.

A idempotência encosta no índice único parcial `messages_dedupe_uidx` (exclui `falha`): consulta prévia por `(tenant_id, dedupe_key)` restrita a `fila/enviado/entregue`, insert em `fila`, e captura de `23505` com releitura da vencedora. O registro de `falha` por opt-in carrega `dedupe_key` mas fica fora do índice, preservando a retentativa legítima posterior. Os outcomes de resultado estão corretamente separados, então o mapa de erro do frontend poderá traduzir "provedor falhou" e "conecte o WhatsApp" como mensagens distintas.

<details>
<summary>Issues (2)</summary>

1. **Lacuna de typecheck Deno (não-bloqueante)** — `npm run build`/`typecheck` não cobrem `supabase/functions/whatsapp/*.ts` (Deno, imports `npm:`/`jsr:`); `deno` ausente neste ambiente. Já declarada na ADR como pendência de QA. Ação: QA roda `deno check supabase/functions/whatsapp/*.ts` + exercita via `supabase functions serve`. (confirmed)
2. **Doc de consumo ADR-06 desatualizado em um ponto (não-bloqueante)** — a linha 19 do ADR-06 e a linha 461 de `analysis-frontend.md` ainda listam o enum de outcome **sem** `send_failed`. ADR-06 está `pending` (ainda não codificada) e a ADR-04 é a dona do contrato, então não afeta este código; ação: incluir `send_failed` no mapa de erro quando a ADR-06/`whatsapp-errors.ts` for implementada. (confirmed)

</details>

<details>
<summary>Details</summary>

## Contrato de fio reconciliado (era o bloqueante da passada 1)

`schemas.ts` define `requestSchema = z.discriminatedUnion("action", [pairInputSchema, sendInputSchema])` com `pairInputSchema = { action: "pair" }` e `sendInputSchema = { action: "send", template, customerId (uuid), appointmentId? (uuid) }`. Isso casa exatamente o que `analysis-frontend.md` §5.1/§5.2 e ADR-06 (`usePairWhatsApp`/`useSendMessage`) invocam: `supabase.functions.invoke("whatsapp", { body: { action: "pair" } })` e `{ action: "send", template, customerId, appointmentId? }`. A quebra silenciosa prevista na passada anterior (discriminated union sem variante casável → 400 "Dados inválidos") foi eliminada. Um `tenant_id` forjado no corpo continua ignorado por não constar no schema e não haver `.passthrough()` — satisfaz A5/CA-13 por construção.

## Outcome de falha de provedor corrigido

`sendOutcomeSchema` agora é `["sent","duplicate","opt_out","not_connected","send_failed"]`. O `catch` do `adapter.sendText(...)` grava `messages.status='falha'`, `failure_reason='provider_error'` (sem PII) e responde `sendResponse({ outcome: "send_failed", message_id, status: "falha", provider_message_id: null }, 502)`. A conflação anterior (`not_connected` no 502) sumiu: a UI poderá distinguir "provedor falhou" de "conecte o WhatsApp". A separação está documentada tanto no comentário do código quanto no JSDoc de `sendOutcomeSchema`.

## Shape de resposta unificado no corpo

Todas as condições de negócio de `send` passam por `sendResponse()`, que emite o DTO `{ outcome, message_id, status, provider_message_id? }` no corpo mesmo com HTTP != 200:

- opt-out → 422, com `message_id` vindo de `.insert(...).select("id").single()` (antes vinha nulo);
- not_connected → 409, `message_id: null`, `status: "falha"`;
- duplicate → 200, relendo `id`/`status`/`provider_message_id` da vencedora;
- send_failed → 502, `message_id` da linha enfileirada;
- sent → 200, com `provider_message_id` do mock.

Só erros de infra/auth (400/401/403/404/405/500) usam `{ error, issues? }` e caem no canal de erro do `functions.invoke` — a separação "resultado esperado no corpo" vs "erro de transporte" está coerente com a nota durável do brain (`regras/.../http-response-shape-contract`) e com o DTO que a ADR declara validado por zod.

## Desvio 409 documentado

A ADR agora traz a "Nota de desvio registrada" explicando que o 409 (`not_connected`) é condição de negócio com corpo DTO, não erro de infra, e que o QA não deve tratar como divergência. Resolve o issue 4 da passada 1.

## Cliente inativo bloqueado

`handleSend` agora consulta `customer.active === false` → 404 pt-BR "Cliente inativo não pode receber mensagens.", antes de qualquer gravação ou chamada ao provedor. A coluna lida no `select` passou a ser usada (resolve o issue 6 da passada 1) e é coerente com o soft-delete de `customers`.

## Segurança/multi-tenant/idempotência — reconferido, segue íntegro

`resolveIdentity` tira o token do header, resolve `auth.getUser(token)` e lê `tenant_id`/`role` de `profiles` com service role; o payload nunca influencia tenant/role. A escrita de `messages`/`whatsapp_instances` só existe aqui com service role — a migration `20250220091000_messages.sql` não cria policy de INSERT/UPDATE/DELETE, então o cliente é negado por RLS (não dá para forjar envio, pular opt-in ou burlar idempotência pelo PostgREST). O índice `messages_dedupe_uidx` é parcial (`where status in ('fila','enviado','entregue')`), batendo com a lógica da função. `pair` exige `admin`; `send` exige `admin|receptionist|professional`; assinatura `bloqueado`/`cancelado` trava o envio no servidor (403), não só na UI. Opt-in LGPD é conferido antes de tocar o adapter. Logs usam `failure_reason` técnico curto e não ecoam `phone`/`text` em claro. Grep no `dist/` não acha service role nem token Evolution; `.env.example` só placeholders sem valor, sem `VITE_`, com aviso. Grep por `cron`/`worker`/`setInterval`/`fetch(` na pasta da função: nada além do comentário que afirma a ausência — só o adapter mock roda.

</details>

<details>
<summary>Arquivos no escopo</summary>

- `supabase/functions/whatsapp/index.ts` — entrypoint HTTP, CORS, auth/derivação de tenant, roteamento por `action`, `handlePair`/`handleSend`, idempotência, DTO unificado no corpo e tratamento de erro. Onde os fixes 1–4/6 da passada 1 foram aplicados.
- `supabase/functions/whatsapp/schemas.ts` — zod do payload (discriminated union `pair`/`send`, camelCase) e DTOs de resposta (`sendOutcomeSchema` com `send_failed`, `sendResponseSchema`). Contrato de fio corrigido aqui.
- `supabase/functions/whatsapp/evolution-adapter.ts` — porta `EvolutionAdapter` + `MockEvolutionAdapter` (zero rede) + stub `RealEvolutionAdapter` + seletor por `EVOLUTION_MODE` default `mock`. Sem ressalvas.
- `supabase/functions/.env.example` — placeholders de servidor, sem valores, sem `VITE_`, com aviso de segurança. Correto.

Diff completo da ADR: `git diff d52949e..3b2ee60`.

</details>
