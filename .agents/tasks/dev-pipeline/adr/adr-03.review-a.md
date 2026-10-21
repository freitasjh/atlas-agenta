# ADR-03 Code Review — REVISOR A

**ADR:** adr-03-edge-function-webhook-inbound.md  
**Escopo:** Edge Function `whatsapp-inbound` + migrations de suporte (webhook_events, confirmed_via, retry fields, reagendar_retorno template, pg_cron setup)  
**Base branch:** origin/master  
**Arquivos sob revisão:** 9 arquivos, 1044 linhas (ver diff stat acima)

---

## Summary

Esta ADR implementa o **primeiro webhook de ENTRADA** do projeto Atlas Agenda: a Edge Function pública que recebe respostas do cliente via Evolution API quando ele responde ao lembrete D-1 no WhatsApp. O código implementa um fluxo rígido e defensivo — **autenticidade → schema → idempotência → resolução/efeito** — com isolamento multi-tenant e PII mínima. 

A implementação segue a especificação da ADR-03 de forma rigorosa: autenticação em tempo constante, validação com zod, dedupe por índice único, casamento determinístico de resposta a agendamento, transição de estado segura contra erro, enfileiramento idempotente de retorno. Todas as migrations são aditivas e versionadas. RLS está habilitado e configurado corretamente. Segredos permanecem fora do cliente.

**Watch for:**
- A função presume que o adapter `normalizePhoneForEvolution` existe em `../whatsapp/evolution-adapter.ts` (reuso de Fatia 1) — confirmado que existe.
- A idempotência de entrada depende do índice único `(source, external_event_id)` em `webhook_events` — implementado corretamente na migration.
- O enfileiramento de `reagendar_retorno` depende do índice de dedupe parcial em `messages` (Fatia 1) — código trata colisão (23505) como ok.
- Transição de status inválida é capturada (23514) sem quebrar — implementado.
- As funções de cron agendadas (`whatsapp_enqueue_lembrete_d1`, `whatsapp_process_retry_queue`) **não estão em escopo desta ADR** (são ADR-04 e ADR-05); a migration apenas agenda as strings de comando, sem validar função.

**Verdict:** APPROVED com notas menores de documentação.

---

## High-level view

A Edge Function lê um POST público (sem JWT) que vem da Evolution quando o cliente responde `1` ou `2` no WhatsApp. Ela valida autenticidade por segredo compartilhado em tempo constante, depois parseia o corpo com zod (tolerante a variações de campo). A idempotência é garantida cedo: grava uma linha de `webhook_events` com id de dedupe; a 2ª chegada do mesmo evento colide no índice único e não produz efeito. O tenant é resolvido pela instância da Evolution, nunca pelo payload — respeitando multi-tenant. A resposta é casada ao agendamento do cliente no tenant, normalizando telefone com E.164. Resposta `1` confirma o agendamento (transição segura, carimba origem); resposta `2` enfileira um retorno automático; qualquer outro texto é ignorado. PII não é persistido (só metadados em `webhook_events`). Toda operação privilegiada roda com service role no servidor, nunca expondo segredos ao cliente. As migrations aditivas estendem `messages` com campos de retentativa, adicionam a tabela `webhook_events` com RLS, criam o novo template `reagendar_retorno`, e configuram o agendador pg_cron (condicional ao ambiente local).

---

<details>
<summary>Issues (2)</summary>

1. **Note: functions whatsapp_enqueue_lembrete_d1 and whatsapp_process_retry_queue not yet defined** — The pg_cron setup migration schedules two jobs by name; the function implementations belong to ADR-04 and ADR-05 (not in scope here). The migration is safe (it does not validate function existence upfront); confirm that ADR-04/05 define the functions before the scheduler runs.

2. **Note: max_attempts default value not specified in ADR-03** — The retry fields migration sets `default 3` for `max_attempts`; the ADR does not fix N. This is safe and reasonable, but confirm with the planner that N=3 is acceptable or adjust in ADR-05 if a different limit is preferred.

</details>

---

## Edge Function logic (`whatsapp-inbound/index.ts`)

The function implements the required rigid order (autenticidade → schema → idempotência → resolução/efeito) with appropriate guards at each stage.

**Autenticidade (R5):** The `timingSafeEqual` function compares two strings byte-by-byte in ~constant time (avoiding timing attacks). The function reads the secret from three possible sources (header `x-webhook-secret`, header `apikey`, or query param `?token=`) — matching the ADR's flexibility for how Evolution might present the token. Without the correct secret, returns 401 and logs denial without revealing configuration. **Correct.**

**Schema (R6):** The `inboundEventSchema` (zod) validates the Evolution payload with deliberate tolerance (`.passthrough()` at every level). This allows for Evolution API evolution without breaking the webhook. Required fields are: `instance` (to resolve tenant), `data.key.id` (for dedupe), `data.key.remoteJid` (for sender), and optional text in `data.message.conversation` or `data.message.extendedTextMessage.text`. Invalid schemas return 400 and register as `rejeitado`. **Correct.**

**Idempotência (R7):** The function inserts into `webhook_events` early, before any business effect. The INSERT uses `external_event_id` (from `data.key.id`) as part of a unique index `(source, external_event_id)`. A redelivery collides with code 23505, which the function treats as "already processed, respond 200 without effect." **Correct and safe under concurrency.**

**Resolving tenant (R12/RNF03):** The tenant is looked up via `whatsapp_instances.evolution_instance_name = instance` (from the Evolution payload), then stored as the `tenant_id` for all subsequent operations. The client-provided payload **never** contributes a `tenant_id` directly. If the instance doesn't map to a tenant (orphan event), the function ignores and returns 200. **Correct isolation.**

**Matching appointment (R8):** The `matchAppointment` function:
1. Loads customers of the resolved tenant.
2. Normalizes the sender's number (E.164) and compares against normalized customer phone values (tolerating legacy numbers without country code).
3. Filters to appointments with `status in ('pendente', 'confirmado')`, `starts_at` in future, and that have had a `lembrete_d1` message sent/delivered.
4. Returns the appointment with the **earliest** `starts_at` (closest in time).
5. Returns null if no match (treated as "ignored" later, no effect).

This is **deterministic** and **correct**. The E.164 normalization reuses `normalizePhoneForEvolution` from the Fatia 1 adapter (confirmed to exist in `evolution-adapter.ts` line 272). The check for prior `lembrete_d1` ensures the response is to a reminder that was actually sent.

**Subscription status check (R3 in context of tenant):** Before applying any business effect, the function checks the tenant's `subscription_status`. If `bloqueado` or `cancelado`, the event is marked `ignorado` with reason `assinatura_suspensa`. Respects the requirement to suspend action during suspension. **Correct.**

**Applying confirmation (R9/R13):** The code handles two cases:
- If the appointment is already `confirmado`, a second update sets `confirmed_via='cliente_whatsapp'` only if it was previously null or different (no re-entry into the trigger).
- If `pendente` or other non-confirmed state, an UPDATE transitions `status='confirmado'` and sets `confirmed_via='cliente_whatsapp'` in a single statement (the trigger `appointments_transition_guard` validates the state transition and stamps `confirmed_at`, but only observes `status` change; `confirmed_via` is not checked by the trigger, so it passes through).

The code captures trigger violations (code 23514 = check_violation) without breaking, logs the failure reason, and registers the event as `processado` with `failure_reason='transicao_invalida'`. **Safe and correct.**

**Enqueuing reagendar_retorno (R10/R14):** The function:
1. Respects opt-in: if `whatsapp_opt_in=false`, registers a `messages` row with `status='falha'` and `failure_reason='opt_in_ausente'` (does not enter the dedupe live set).
2. Checks for existing live dedupe entry (`dedupe_key='reagendar_retorno:a:<appointmentId>'` in status `fila|enviado|entregue`); if found, returns early (no duplicate).
3. Inserts the message into `fila` with `attempts=0`, `next_attempt_at=now()`.
4. Treats insertion collisions (23505) as a concurrency race (both invocations tried to insert at once, one won) — silent, no error. Comment already present: "corrida de idempotência".

The payload includes `origin: "inbound_reagendar"` (no PII). **Correct.**

**PII handling (R19):** The `webhook_events.payload` contains only `instance_name`, `event`, and `message_ts` (no phone, document, or raw text). The sender's number is normalized in memory for matching but never persisted to `webhook_events` or logs. The matched customer ID is used in `messages`, not the phone. The intended reply text (`1` or `2`) is interpreted abstractly (confirmar / reagendar) and never stored as raw text. Logs emit no PII. **Excellent.**

**Response handling:** The function always returns `200` for accepted events (even if ignored), preventing infinite redelivery loops from Evolution. Only autenticidade failures (401) and schema validation failures (400) return error codes. All responses are JSON with no PII. **Correct.**

---

## Migrations

### `20250223090000_webhook_events.sql`

Creates the `webhook_events` table with:
- `tenant_id` (NOT NULL, FK to tenants, cascades) — required, never defaults.
- `source` (enum 'evolution') — future-proof for other webhook sources.
- `external_event_id` (text, part of unique index `(source, external_event_id)`) — the dedupe key.
- `instance_name` — correlates to `whatsapp_instances` for debugging.
- `status` (enum: recebido|processado|ignorado|rejeitado) — lifecycle.
- `parsed_intent` (enum: confirmar|reagendar|nao_reconhecido, nullable) — result of parsing.
- `appointment_id` (uuid, nullable, FK to appointments via tenant-scoped composite) — matched target.
- `payload` (jsonb, default {}) — PII-free metadata.
- `failure_reason` (text, nullable) — technical short reason for rejection/ignorance.

RLS is enabled. Policy: SELECT only for `admin` of the tenant (audit logs, sensitive input). No INSERT/UPDATE/DELETE policies — the service role only. **Correct isolation and access control.**

The composite FK `(tenant_id, appointment_id) → appointments (tenant_id, id)` enforces data integrity in the DB: an event can only link to an appointment of the same tenant. `MATCH SIMPLE` — the FK is only checked when `appointment_id` is NOT null (allowing orphan events to be recorded). **Correct.**

Idempotence: `create table if not exists`, `create index if not exists`, `drop policy if exists` before `create policy`. Second application (e.g., `db reset`) does not fail. **Correct.**

### `20250223091000_appointments_confirmed_via.sql`

Adds column `confirmed_via` (text, check `in ('cliente_whatsapp','manual')`, nullable) to `appointments`. This implements PRD §2.4 Option A: deterministic column instead of join-based inference. Nullable allows NULL (not yet confirmed) and handles legacy rows. Migration is aditiva (`add column if not exists`), does not alter RLS or indexes. Comment documents the semantics. **Correct.**

### `20250223092000_messages_retry_fields.sql`

Extends `messages` with retry machinery:
- `attempts` (int default 0) — count of send attempts.
- `max_attempts` (int default 3) — limit N (not specified in ADR-03, reasonable default).
- `last_attempt_at` (timestamptz) — diagnostic timestamp of last try.
- `next_attempt_at` (timestamptz) — when the next retry is eligible (backoff).

Adds partial index `messages_retry_queue_idx` on `(next_attempt_at)` where `status = 'fila'` — allows the worker (ADR-05) to efficiently scan eligible entries. Does not alter the existing dedupe index `messages_dedupe_uidx`. Aditiva and idempotent. **Correct.**

### `20250223093000_reagendar_retorno_template.sql`

Adds the 5th template key (`reagendar_retorno`) to:
1. **CHECK constraint of `messages.template`:** The migration drops the old CHECK (auto-named by Postgres) and creates a new one with name `messages_template_allowed_check` containing all 5 values. Uses a `do $$` block to check `pg_constraint` before dropping (safe re-apply).
2. **CHECK constraint of `message_templates.template_key`:** Same pattern, new name `message_templates_template_key_allowed_check`.
3. **Function `seed_message_templates(uuid)`:** Recreated with `create or replace`, adds the 5th row to the VALUES list (keeping the original 4 identical). Uses `on conflict (tenant_id, template_key) do nothing` for idempotence.
4. **Backfill:** Inserts the new row for all existing tenants with `on conflict do nothing`. Safe on re-apply.

Text: `'Oi {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.'` — pt-BR, uses only the closed list of variables (no PII), no value for `{valor}` (out of scope). **Correct.**

### `20250223094000_pg_cron_setup.sql`

Sets up the scheduler infrastructure (not the job functions themselves; those are ADR-04/05):
1. **Extension:** `create extension if not exists pg_cron` inside a `do $$` block with exception handling — if unavailable in local Postgres, emits notice and continues (does not break `db reset`). **Correct — allows local dev without pg_cron.**
2. **Guard:** Checks if `pg_extension` contains 'pg_cron' before calling `cron.schedule`. (Does not use `to_regproc` because `cron.schedule` is overloaded and `to_regproc` would fail on ambiguity.) **Correct.**
3. **Jobs:** Registers two jobs by name — `atlas_lembrete_d1` (every 15 min) and `atlas_retry_queue` (every 5 min). Before each `cron.schedule`, runs `cron.unschedule` to remove any prior job with the same name (idempotence on re-apply). **Correct.**

The job command strings refer to functions `whatsapp_enqueue_lembrete_d1()` and `whatsapp_process_retry_queue()` — **not defined in this ADR** (belong to ADR-04 and ADR-05). `cron.schedule` does not validate function existence upfront (stores the string), so no error here. **Safe, but confirm that ADR-04/05 define the functions before the scheduler runs.**

---

## Configuration

### `supabase/config.toml`

Adds `[functions.whatsapp-inbound]` with `verify_jwt = false`. This disables JWT verification **only** for the `whatsapp-inbound` function (all others use the default `verify_jwt = true`). The function still validates autenticidade via the shared secret in `WHATSAPP_WEBHOOK_SECRET`. **Correct — appropriate for a public webhook endpoint.**

### `supabase/functions/.env.example`

Adds `WHATSAPP_WEBHOOK_SECRET=` (empty, as example) with documentation that the secret is server-only, never client-side, never `VITE_*`. Notes that `EVOLUTION_MODE`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` are placeholders for future phases (not used in mock mode, which is the current default). **Correct — teaches the developer to set the secret in the server's `.env` or Supabase secrets, not in version control.**

---

## Test of criteria

Running the build, typecheck, and existing tests:
- **`npm run build`:** ✅ Passed (6.01s, including the new Edge Function Deno code).
- **`npm run typecheck` (tsc -b):** ✅ Passed.
- **`npm test` (vitest):** ✅ 32 tests passed (existing suites for `message-templates` and `scheduling-slots`, unchanged).

No new unit tests for the webhook logic in this ADR; the code is exercised via integration testing (simulated webhook payloads in ADR-07 QA).

---

## Boundary and security verification

**RLS & multi-tenant isolation (RNF03):** ✅ `webhook_events` has RLS enabled with policy restricting SELECT to `admin` of the tenant. No INSERT/UPDATE/DELETE policies (service role only, no client write). FK composite `(tenant_id, appointment_id)` enforces tenant coherence in the DB. Tenant is never read from the webhook payload; always resolved via instance.

**Autenticidade & idempotency (RNF-S2-03, R5, R7):** ✅ Segredo comparado em tempo constante. Idempotência by unique index on `(source, external_event_id)`.

**PII (R19, LGPD):** ✅ No phone/document/raw text in `webhook_events.payload` or logs. Customer identified by ID, not number.

**Secrets outside client (R20):** ✅ `WHATSAPP_WEBHOOK_SECRET` in env/secret, no `VITE_*`, not in bundle.

**Migrations versionados (R21):** ✅ Aditivos, idempotentes, no edit of prior migrations.

---

## Design alignment

**Frontend dependencies (ADR-06):** The implementation provides `confirmed_via='cliente_whatsapp'` in `appointments` (the frontend reads this for the confirmation source badge). The frontend is **not** in scope of this ADR (reviewed separately in ADR-06), but the data contract is honored.

**Retry queue contract (ADR-05):** The implementation enqueues `messages` with `status='fila'`, `attempts=0`, `next_attempt_at=now()`, allowing ADR-05 (worker) to drain and retry. The contract is honored (ADR-05 is reviewed separately).

**Cron job names (ADR-04/05):** The setup migration references functions by name; the implementations belong to other ADRs and are out of scope here.

---

## Notes for the planner / next ADRs

1. **ADR-04 (lembrete D-1 job):** Define function `whatsapp_enqueue_lembrete_d1()` that the cron calls (every 15 min). Implement the elegibility logic per ADR-01 analysis-data.md RF-S2-01.
2. **ADR-05 (retry worker job):** Define function `whatsapp_process_retry_queue()` that drains `messages` in `fila` per ADR-05 criteria (backoff, limit N, janela útil).
3. **ADR-07 (QA consolidada):** Test the webhook with simulated payloads (1, 2, duplicado, inválido/não-autêntico) via curl; verify states in `webhook_events`/`appointments`/`messages`.
4. **Confirm Evolution v2.3.7 payload format:** The schema in `schemas.ts` is tolerant and will work, but confirm exact field names (`data.key.id`, `remoteJid`, `message.conversation`, etc.) against live server to catch any version skew.
5. **Default `max_attempts=3` in retry fields:** If a different limit N is preferred, adjust the migration default or override in ADR-05 job.

---

## Summary

**All requirements from ADR-03 are implemented correctly.** The webhook is defensively designed (autenticidade → schema → idempotência → resolução/efeito), isolates multi-tenant, respects PII and LGPD, maintains audit trail in `webhook_events`, and integrates safely with the existing `appointments` and `messages` schema. Migrations are aditivas and versionadas. No secrets leak to the client. Code passes build and typecheck. 

Two notes: (1) the pg_cron setup references functions not yet defined (ADR-04/05); (2) the retry max_attempts default is 3 (not specified in ADR-03, but reasonable).

**Verdict: APPROVED** — ready to merge pending ADR-04/05 function implementations and ADR-07 QA verification.

