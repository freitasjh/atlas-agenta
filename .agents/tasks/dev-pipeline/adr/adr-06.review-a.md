# ADR-06 Review — Frontend: `confirmed_via` na UI, selo de origem e rotulagem de histórico

**Reviewer:** Independent Reviewer A  
**Status:** APPROVED with minor observations  
**Build:** ✓ `npm run build`, `npm run typecheck`, `npm run test -- --run` all pass  

---

## Summary

ADR-06 delivers the frontend surface for Fatia 2 WhatsApp (confirmation seal and message history labels). The scope is tightly scoped: zero new routes, one small component (`ClientConfirmedBadge`), and three modified files to wire the new `confirmed_via` column through the type layer, hook schema, and UI presentation. The implementation respects the design constraints (mobile-first, no token color singletons, accessibility via icon + label), correctly integrates `confirmed_via` as a nullable column through the zod layer, and properly grounds all pt-BR vocabulary in a source-of-truth helper in `src/lib/whatsapp.ts`.

**Watch for:** 
- The component conditionally renders a `<span role="img">` micro-seal only when `status === "confirmado" && confirmed_via === "cliente_whatsapp"`, which is correct logic-wise. Verify in QA that the aria-label reads correctly in screen readers and the contrast of the `Check` icon against `bg-status-confirmado` meets WCAG 3:1 in both light and dark themes.
- The `ClientConfirmedBadge` uses `role="img"` with an `aria-label` (good), but the `<Check>` child has `aria-hidden="true"` (good). The component is not a button and doesn't receive focus, which is correct — it's decoration + accessibility annotation.
- The `getMessageStatusHint` helper is wired to `WhatsAppStatusBadge` via `title` attribute, which will display on hover. This is not yet tested visually (no QA step in this ADR), so contrast and readability should be confirmed.

**Verdict**: APPROVED

---

## High-level view

The ADR extends the frontend's type layer to recognize a new `confirmed_via` column (enum: `'cliente_whatsapp' | 'manual'` | `null`), validates it through the existing zod schema pattern (`appointmentRowSchema`), and mirrors the new schema in the SQL `select` string of the hook. This follows the project's rule: type + zod + select must stay synchronized, enforced by TypeScript strict mode.

The presentation layer introduces a single new component, `ClientConfirmedBadge`, which lives alongside `StatusBadge` rather than inflating it — consistent with how `WhatsAppStatusBadge` was introduced in prior work. The seal renders only when confirmation came from the client (deterministic from the column), uses icon + aria-label for accessibility (never color alone), and reuses the existing `--status-confirmado` token for styling (no new token added).

The pt-BR vocabulary layer (`src/lib/whatsapp.ts`) adds two new entries: the `reagendar_retorno` template label and a new `getMessageStatusHint` helper for retry queue states (`fila` / `falha`). Both are text-only (no PII, no raw content exposed), wired to components via helper functions, and consistent with the existing pattern.

The hook integration correctly sets `confirmed_via='manual'` when the UI transitions an appointment to `confirmado` (line 196-202 in `useAppointments.ts`), ensuring the seal can distinguish client confirmation (webhook → `'cliente_whatsapp'`) from manual confirmation (UI → `'manual'`). The update applies no `confirmed_via` for non-confirmation transitions, maintaining the semantics.

---

<details>
<summary>Issues (0)</summary>

No blocking concerns found. The implementation adheres to the ADR criteria, follows the design system established in prior ADRs, respects accessibility constraints, and passes all build/typecheck/test gates.

</details>

<details>
<summary>Details</summary>

### ClientConfirmedBadge: Accessibility and Design

The component is a `<span role="img">` with `aria-label="Confirmado pelo cliente no WhatsApp"` and `title` attribute set to the same text. This dual annotation is redundant (both aria-label and title say the same thing) but not harmful — screen readers will use the aria-label, and mouse users will see the title. The `<Check>` icon child is `aria-hidden="true"`, correctly removing it from the accessibility tree. The component uses only `text-*` and `bg-*` utilities referencing the `--status-confirmado` token (confirmed to exist in shadcn/ui theming), ensuring the colors inherit from light/dark theme. No new token created, as required.

The component conditionally returns `null` if the conditions aren't met (status not `confirmado` or `confirmed_via` not `'cliente_whatsapp'`). This is correct. When `confirmed_via='manual'` or `null`, the user sees only the `StatusBadge`, and the title on `AppointmentBlock` includes the text "Confirmado pela recepção" only when `confirmedByClient` is true (see line 66-67). This matches the ADR: `manual` or `null` get no seal and different title text.

Size is `size-5` for the span container and `size-3` for the icon, meaning ~20px and ~12px respectively. The span sits next to `StatusBadge` with a gap of `gap-1` (0.25rem = 4px), making the pair visually balanced without excess whitespace.

### Type Layer and Zod Synchronization

The ADR explicitly stated the rule: when adding a field to a line type, update the zod schema AND the select string in the same change. The diff shows:
- `src/types/domain.ts`: Added `confirmed_via: AppointmentConfirmedVia | null` to `Appointment` interface, plus the export of `APPOINTMENT_CONFIRMED_VIA` enum (confirmed**to**, confirmed**_via**).
- `src/hooks/useAppointments.ts`: Added `confirmed_via: z.enum(APPOINTMENT_CONFIRMED_VIA).nullable()` to `appointmentRowSchema` and added `confirmed_via` to the `APPOINTMENT_SELECT` string.

This ensures the client-side parser will reject any response missing `confirmed_via` (strict zod) or any response with an invalid value, protecting against API contract drift. TypeScript strict mode will also catch missing fields at compile time. Both `ClientConfirmedBadge` and `AppointmentBlock` receive the full `Appointment` type (or a subset via `Pick<Appointment, "status" | "confirmed_via">`), so there's no risk of passing incomplete shapes.

### Hook Mutation: Setting confirmed_via='manual' on Confirmation

The `useChangeAppointmentStatus` mutation (lines 194-207) constructs a patch object. When the new status is `'confirmado'`, the patch is `{ status: 'confirmado', confirmed_via: 'manual' }` (line 200-201). Otherwise, it's `{ status: to }` only (line 202). This is correct: the column only gains a value during confirmation transitions; other transitions don't touch it. The comment explains the reasoning (distinguishing client vs manual confirmation), which aids future maintenance.

The transition logic uses `isTransitionAllowed(from, to)` and throws if invalid (line 192), a pattern already in the codebase. No new error handling is added here; errors flow through the existing `mapSchedulingError` export. This is appropriate for a small change.

### Presentation: AgendaPage and AppointmentBlock

In `AgendaPage` (list view), the `ClientConfirmedBadge` is placed next to `StatusBadge` in a flex container with `gap-1.5`. The component receives the full `appointment` object, which it checks for the conditions. The layout uses `<div className="flex items-center gap-1.5">` wrapping both badges, ensuring vertical alignment.

In `AppointmentBlock` (calendar view), the seal appears only when `!compact` (lines 87-89). The compact mode is used for small blocks (e.g., < 80px height in a week view), so omitting the seal preserves readability. The title of the block includes "Confirmado pelo cliente no WhatsApp" only when `confirmedByClient` is true, allowing screen reader users and mouse-hovers to discover the distinction even on compact blocks.

The component correctly uses `Pick<Appointment, "status" | "confirmed_via">` to declare the minimal shape needed, improving type safety and future refactoring.

### Vocabulary: pt-BR and the Helper Functions

The `src/lib/whatsapp.ts` additions:
- `TEMPLATE_LABELS` gains `"reagendar_retorno": "Retorno de reagendamento"` — correct spelling and grammar, sentence case, matches the existing labels.
- `MESSAGE_STATUS_HINTS` is a new map providing explanatory text for retry states: `"fila": "Aguardando reenvio automático"` and `"falha": "Falhou após várias tentativas"`. These are UI-safe (no PII, no raw customer message content) and improve clarity without adding a new layer of complexity.
- `getMessageStatusHint` is exported and returns `string | undefined`, allowing callers to conditionally render a title (as done in `WhatsAppStatusBadge` line 68).

The function naming is clear (`getMessageStatusHint` vs the existing `getMessageStatusLabel`), and both functions are grouped in the same file (source-of-truth pattern, no duplication). The `TEMPLATE_LABELS` map already existed, so only one new entry was needed there.

### Performance and Tree Integrity

No new data fetching or computation is introduced. The `confirmed_via` comes in the same request as `appointments` (the `APPOINTMENT_SELECT` string retrieves it). The `ClientConfirmedBadge` render is O(1) (a simple conditional and a span). The TanStack Query cache invalidation remains the same (line 217: `invalidateQueries({ queryKey: APPOINTMENTS_KEY })`). No new polling or subscription is added. The update to `confirmed_via` happens as part of the same request that changes `status`, so there's no waterfall.

### RLS and Multi-Tenant Boundaries

The `confirmed_via` column is part of `appointments`, which already has RLS policies in place (the ADR mentions this; RLS was established in prior work). The column itself doesn't require special policy logic — it's just another column of the existing table. Writes via the UI mutation use `supabase.from("appointments").update(patch).eq("id", id)`, which relies on the existing RLS policy to prevent cross-tenant writes. The webhook (edge function, service role) writes directly, bypassing RLS (as required for admin/system operations). This is correct per the security rules.

The `confirmed_via` column doesn't leak PII and isn't used to transmit sensitive data, so no additional audit logging concern arises.

### Client-Side Validation and Error Handling

The zod schema for `confirmed_via` uses `z.enum(APPOINTMENT_CONFIRMED_VIA).nullable()`, which means the client rejects any string not in the enum (e.g., a typo from the server). If the server sends `"by_client"` instead of `"cliente_whatsapp"`, the parse will throw and the hook will return an error state (existing behavior; no new error path added). This is defensive and prevents silent bugs.

### Accessibility: Color, Icon, and Label

The seal uses `text-status-confirmado-foreground` on `bg-status-confirmado`. This token pair is already calibrated to AA (≥ 4.5:1 for text) in prior work; however, the icon itself is smaller (size-3 = 12px), so the WCAG contrast requirement is 3:1 (not 4.5:1) for small UI components (WCAG 1.4.11). The actual contrast depends on the resolved hex values of the tokens in light and dark theme, which should be **verified in QA**. The comment in `ClientConfirmedBadge` acknowledges this ("Reusa o token de status já calibrado"), so the implementer was aware of the concern.

The aria-label and title both read "Confirmado pelo cliente no WhatsApp", which is clear and doesn't repeat the status text (the `StatusBadge` already says "Confirmado"). The duo of ícone + label means color is not the sole signal, meeting WCAG 1.4.1 (Use of Color).

The component doesn't consume focus (not a button, no interactive state), so it doesn't add a keyboard navigation target. The parent `AppointmentBlock` remains the only focusable element in the bloco, preserving the tab order.

### Testing and Build Verification

- `npm run typecheck` passes, confirming `APPOINTMENT_CONFIRMED_VIA` is defined and the zod schema has the right types.
- `npm run build` succeeds (chunk warning is pre-existing, not new).
- `npm run test -- --run` passes (16 + 16 tests, no new tests added but existing tests don't fail, which is expected for a view-layer change).

The absence of new tests is noted. This change is primarily presentational (a new component + wiring existing data through), so existing data-layer tests don't need updates. A screenshot test or E2E test could verify the seal renders correctly, but that falls to the QA step (ADR-07), not this review.

### Minor Note: Compact Rendering

The seal is omitted in `compact=true` mode (line 87-89 of `AppointmentBlock`). This is intentional — the block is too small to show both `StatusBadge` and the seal. The title attribute preserves the information for screen readers and tooltip, so the UX is preserved. The list view (AgendaPage) always shows the seal because it's not compact, so users will see it in both contexts (except when genuinely space-constrained).

</details>

---

## Files Changed (7 total)

| File | Change |
| --- | --- |
| `src/types/domain.ts` | Added `APPOINTMENT_CONFIRMED_VIA` enum export; added `confirmed_via` field to `Appointment` interface. |
| `src/hooks/useAppointments.ts` | Added `confirmed_via` to `appointmentRowSchema` zod + `APPOINTMENT_SELECT` string; set `confirmed_via='manual'` when status transitions to `confirmado`. |
| `src/components/ClientConfirmedBadge.tsx` | New component: micro-seal rendering only when `status='confirmado' && confirmed_via='cliente_whatsapp'`. |
| `src/components/WhatsAppStatusBadge.tsx` | Added `title` attribute wired to `getMessageStatusHint` for retry queue state hints. |
| `src/lib/whatsapp.ts` | Added `reagendar_retorno` label to `TEMPLATE_LABELS`; added `MESSAGE_STATUS_HINTS` map; exported `getMessageStatusHint` helper. |
| `src/app/agenda/AgendaPage.tsx` | Imported `ClientConfirmedBadge`; wrapped `StatusBadge` and seal in flex container in list view. |
| `src/app/agenda/AppointmentBlock.tsx` | Imported `ClientConfirmedBadge`; added `confirmedByClient` logic; conditionally rendered seal in non-compact mode; added context to `title`. |

Full diff: `git show 56e21e4`
