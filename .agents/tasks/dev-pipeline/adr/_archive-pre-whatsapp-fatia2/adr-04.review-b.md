# Revisor B — ADR-04: Renderização server-side no `handleSend`

Server-side rendering of per-tenant WhatsApp templates in the `whatsapp` Edge Function. `handleSend` stops sending the raw template key (`"confirmacao"`) and now loads the tenant's template `body` under service role, resolves `{nome}/{servico}/{dataHora}/{empresa}`, and hands the rendered text to the adapter. A new `render.ts` mirrors the ADR-03 closed variable list, fallback table, and the ADR-02 default bodies for legacy tenants without a baseline row. The five send outcomes, opt-in, idempotency and connection checks are untouched.

Watch for: an orphaned `fila` row + out-of-contract 500 if `resolveRenderedText` throws after the message is enqueued — reachable via `Intl.DateTimeFormat` with a malformed tenant `timezone` (likely). Parity between `render.ts` and `src/lib/message-templates.ts` is a manual-discipline contract with no automated guard (confirmed). Deno could not be type-checked in this environment (confirmed).

**Verdict**: APPROVED

## High-level view

The change is scoped exactly to what ADR-04 authorizes: `supabase/functions/whatsapp/index.ts` and a new `supabase/functions/whatsapp/render.ts`. No schema, no client, no new wire contract. The `send` payload shape is unchanged and the five outcomes are produced under the same conditions and HTTP status codes as before — the only behavioral change is the text handed to `adapter.sendText`.

The multi-tenant boundary holds. Every read in `resolveRenderedText` (`message_templates`, `tenants`, `appointments`) is filtered by the `tenantId` derived from the JWT, never from the payload. Service role is used for resolution, which is the intended privileged path, and the `appointmentId` from the client is additionally constrained by `tenant_id`, so a forged id from another tenant resolves to nothing and falls through to the fallback rather than leaking cross-tenant data.

The fallback ladder matches the PRD: a missing/inactive template row drops to `DEFAULT_TEMPLATE_BODIES` (never the raw key, never empty); a missing resolved value drops to the pt-BR fallback; an unknown token stays literal. The default bodies are byte-identical to the ADR-02 seed, and the render logic is byte-identical to the ADR-03 canonical module except for one comment.

PII discipline is intact: no `console.*` logs the rendered text, the customer name, or the phone, and `messages.payload` still carries only `template` + `appointment_id`.

The one real gap is lifecycle: rendering happens after the row is inserted as `fila` but outside the try/catch that transitions the row to `enviado`/`falha`. The three reads swallow their errors, but `formatDataHora` calls `Intl.DateTimeFormat` with the tenant's free-text `timezone`, which throws `RangeError` on a malformed value — that unwinds to a generic 500 (not one of the five `SendResponse` outcomes) and leaves the row stuck in `fila`, which the idempotency check then treats as a live duplicate and blocks re-sends. Not blocking, but worth a follow-up.

<details>
<summary>Issues (3)</summary>

1. **Orphan `fila` row on render throw** — `resolveRenderedText` runs after the `fila` insert but outside the send try/catch; an unexpected throw (e.g. `Intl` with a bad `timeZone`, or a transport error on one of the three reads) leaves the message stuck in `fila` and returns a non-contract 500. Consider resolving the text *before* the `fila` insert, or wrapping the render in the same failure path that marks the row `falha`. Likely; non-blocking.
2. **Parity is manual-only** — `render.ts` and `src/lib/message-templates.ts` must stay identical, but nothing fails CI if they drift (the app test suite doesn't import the Deno file, and Deno isn't checked here). A shared fixture or a note-level cross-test would close it. Confirmed; accepted debt per ADR-03/04, worth tracking.
3. **Deno not type-checked in this env** — `tsc -b` excludes `supabase/functions`; `deno` is not installed, so `render.ts` and the `handleSend` edits weren't statically verified against the Deno runtime. Live QA (ADR-07) must serve the function and confirm. Confirmed.

</details>

<details>
<summary>Details</summary>

### Scope adherence and the wire contract

The diff touches only the two files ADR-04 names. `sendInputSchema` is unchanged, so `action|template|customerId|appointmentId?` still describes the wire. The render is inserted after every pre-existing gate (role, tenant, subscription suspension, customer resolution, opt-in, idempotency, connection) and before `adapter.sendText`, exactly where the ADR places it. The only other production edit is adding `name` to the `customers` select — necessary for `{nome}` and correctly flagged in the comment as PII resolved under service role within the tenant.

The five outcomes (`sent | duplicate | opt_out | not_connected | send_failed`) keep their conditions and status codes (200/200/422/409/200-or-502). AC-07 holds for every path that returns a `SendResponse`.

### Multi-tenant resolution under service role

```
resolveRenderedText(input, tenantId, customerName, service)
  message_templates .eq tenant_id .eq template_key .eq active   → body | DEFAULT
  tenants           .eq id = tenantId                            → trade_name|legal_name|timezone
  appointments      .eq tenant_id .eq id = appointmentId         → starts_at, services(name)
```

`tenantId` is the JWT-derived value threaded from `handleSend`; the client-supplied `appointmentId` is always paired with `.eq("tenant_id", tenantId)`, so a cross-tenant id resolves to no row and the `{servico}/{dataHora}` fallbacks cover it — no leak, matches the PRD defeito #1 boundary. The `services(name)` embed is backed by a real composite FK (`appointments_service_fk` on `(tenant_id, service_id)`), and the code defensively handles the embed arriving as either object or array.

### Fallback ladder and parity

Three fallback levels, all per the PRD. Template row missing or `active = false` → `DEFAULT_TEMPLATE_BODIES[key]`; these four strings are byte-identical to the ADR-02 seed migration (`20250222091000_message_templates_baseline.sql`), so a legacy tenant and a seeded tenant render the same text for the same template. Missing variable value → pt-BR fallback (`cliente`, `seu atendimento`, `no horário combinado`, `nossa equipe`). Unknown token → kept literal.

The render primitives in `render.ts` match `src/lib/message-templates.ts` exactly: `TEMPLATE_VARIABLES`, `TEMPLATE_FALLBACKS`, `TOKEN_PATTERN`, and the `renderTemplate` body differ only by one inline comment. The parity is a documented manual contract (both files carry the "mirror" header), but there is no automated guard against drift — the app vitest suite can't import the Deno module and Deno isn't run in CI here. Accepted debt per the ADRs; the risk is a future edit to one side that silently desyncs preview from sent text.

### PII and secrets

No new leak surface. `resolveRenderedText` logs nothing; the rendered text (which contains the customer name) is never passed to `console.*`, and the existing `console.error` calls log only `.message`/short reasons. `messages.payload` still stores only `template` + `appointment_id`. No Evolution secret appears in the diff. AC-08 holds.

### Lifecycle gap on render failure

The render sits between the `fila` insert and the send try/catch:

```
insert messages status=fila  → messageId
renderedText = await resolveRenderedText(...)   // ← outside try/catch
try { adapter.sendText(...); update status=enviado }
catch { update status=falha }
```

The three reads inside `resolveRenderedText` destructure only `data` (errors swallowed), so a Supabase error won't throw — but `formatDataHora` calling `Intl.DateTimeFormat` with an invalid `timeZone` *does* throw `RangeError`, and the tenant's `timezone` column is free text. If that throws, the exception unwinds to the `Deno.serve` catch, which returns a generic `{ error }` 500 — not a `SendResponse` — and the `fila` row is never transitioned, leaving an orphan that the idempotency check will later treat as a live duplicate, blocking re-sends with the same dedupe key. Resolving the text before the `fila` insert, or folding the render into the row's failure path, would close it. Low likelihood (requires a malformed tenant timezone), so non-blocking, but it's the one place the "five outcomes always hold" invariant can be bypassed.

### Verification run

`npm run build` (tsc -b + vite build) clean. `npm run test` green: 24/24, including the 8 ADR-03 render-contract tests. The Edge Function is Deno and excluded from `tsc -b` (app tsconfig includes only `src`); `deno` is not installed in this environment, so `render.ts` and the `handleSend` edits were reviewed by reading, not type-checked. Live QA (serve the function + adapter mock) is correctly deferred to ADR-07.

</details>

<details>
<summary>Arquivos no escopo da ADR-04 (commit 18a53d3)</summary>

- `supabase/functions/whatsapp/index.ts` — `resolveRenderedText` added; `handleSend` now selects `customer.name`, renders, and sends the rendered text instead of `input.template`.
- `supabase/functions/whatsapp/render.ts` — new; Deno mirror of the ADR-03 render contract + ADR-02 default bodies + `formatDataHora` via `Intl`.

Diff: `git show 18a53d3`.

</details>
