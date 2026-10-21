# Calendar day/week views with a user-level toggle on AgendaPage (ADR-08) — Review B (pass 2)

ADR-08 adds a Lista · Dia · Semana toggle to `/app/agenda` plus day/week calendar renderings, reusing the day's existing `useAppointments` query (no new request, no waterfall) and the status tokens/`StatusBadge` from the list. The view preference lives per user in `localStorage`, never as tenant config (AC-19). Empty calendar strips feed the ADR-06 dialog via a `prefill` prop. The diff is exactly the five files the ADR declared (4 new + `AgendaPage.tsx` edit); no out-of-scope file, no SQL/migration, no `tenant_id` handling, no service-role path — correct for a frontend-only ADR.

Pass 1 (review-b) returned NEEDS_CHANGES on two confirmed design-doc deviations: the week view did not degrade to a navigable single day on mobile, and the empty-strip creation was not keyboard-usable per time. The fix commit `86854bc` addresses both, touching only the two files flagged. This pass verifies the fixes and re-checks the boundary/RBAC/timezone posture; both prior concerns are resolved and no new blocking concern surfaced.

Watch for: the pointer-offset empty-strip time is still snapped to a hardcoded 30-min step regardless of the professional's `slot_step_minutes` (confirmed, minor — the SlotPicker recomputes valid starts after the dialog opens, so the prefill is only a seed); and the multi-column "todos" day view still draws no expediente band because `useWorkingHours(null)` returns empty (confirmed, by-design per the ADR). Neither blocks.

**Verdict**: APPROVED

## High-level view

The two pass-1 deviations are fixed. `AgendaCalendarWeek` now renders a `sm:hidden` single-day block with prev/next arrows wired to `onSelectDay` (±1 day), and the 7-column grid is `hidden sm:block` — so 360px gets an arrow-navigable day, matching the ADR's Consequências and frontend analysis §3.5. AgendaPage passes `onSelectDay={setDay}`, so the arrows re-focus the day and the shared query loads it. `AgendaCalendarDay` now renders one empty-strip button per hour, each with `aria-label="Criar agendamento às HH:MM"` and keyboard focus; a keyboard activation on a focused hour button lands at that hour's start, which is the time-specific, keyboard-reachable affordance the ADR described.

Boundaries remain a genuine no-op: no SQL, no migration, no `tenant_id` constructed or forwarded, no service-role, no secret, no webhook — isolation stays in RLS, reused through the shared `useAppointments` query. RBAC is UI defense-in-depth only: `singleColumn` collapses to the own agenda for `professional`, and `onOpenAppointment`/`onCreateAt` are gated on `canManageAppointments` (with `openCreateAt` re-checking it before seeding prefill). No financial data reaches these components.

Timezone (AC-16) is correct in both views: blocks position via `toTenantLocal`/`formatTimeInTenantTz`, the now-line's "is today" is computed in tenant-local, and the week's weekday arithmetic runs on the plain `YYYY-MM-DD` string via `Date.UTC` (the tenant calendar day), so no UTC drift.

The contraprova is green: `tsc -b`, `vite build` and the 16-test `scheduling-slots` suite all pass; the only build warning is the pre-existing >500 kB chunk, unrelated to this ADR.

<details>
<summary>Issues (2)</summary>

1. **Empty-strip pointer snap is hardcoded to 30 min** (confirmed, minor) — `timeFromHourOffset` in `AgendaCalendarDay` rounds the pointer offset to 30-min increments regardless of the professional's `slot_step_minutes` (ADR-01). Non-blocking: the keyboard path uses each hour button's own start, and the SlotPicker recomputes valid starts after the dialog opens, so the prefill time is a seed, not a committed slot. Worth aligning the snap to `slot_step_minutes` in a follow-up so the seeded time can't suggest an off-step start.
2. **Multi-column "todos" day view has no expediente band** (confirmed, by-design) — when admin/receptionist view all professionals, `useWorkingHours(null)` returns empty, so no working-hours shading is drawn and the hour window is derived from appointments only. The ADR acknowledges this (the band needs a focused professional); flagged only so QA does not read the missing band as a regression when "Todos" is selected.

</details>

<details>
<summary>Details</summary>

### Pass-1 issue #1 — week view mobile degradation: fixed

The week component now splits cleanly by breakpoint:

```
sm:hidden  → single-day card with ChevronLeft/ChevronRight → onSelectDay(shiftIsoDate(day, ±1))
hidden sm:block → overflow-x-auto wrapper around grid min-w-[640px] grid-cols-7 (unchanged, desktop)
```

On 360px the 7-column grid is hidden and the user gets one day with prev/next arrows (`aria-label` "Dia anterior"/"Próximo dia"), the focused-day lane, and a tenant-tz, `font-primary`-highlighted "today" marker. The arrows call `onSelectDay`, which AgendaPage wires to `setDay`, re-focusing the day and loading it through the same shared query (still one day's worth of data, honoring RNF01). This matches the ADR Consequências ("a semana no mobile é dia-navegável") and frontend analysis §3.5, and the per-ADR AC "Semana degrada para dia navegável" now reads as met. The desktop grid behavior (only the focused column carries appointments, the other six are intentionally empty to avoid seven requests) is unchanged and documented in the component's docstring.

### Pass-1 issue #2 — keyboard-reachable, per-time empty strips: fixed

The day view no longer uses a single full-height button whose time came from `event.clientY`. It now renders one button per hour:

```
hours.slice(0, -1).map((hour) => (
  <button aria-label={`Criar agendamento às ${minutesToHhmm(hour*60)}`}
          style={{ top: (hour-startHour)*HOUR_HEIGHT, height: HOUR_HEIGHT }} ... />
))
```

Each hour is its own focusable button with a time-specific `aria-label`, so a keyboard-only operator tabs to the hour they want and activates it — the dialog opens prefilled at that hour's start. Pointer users still get sub-hour precision: `onClick` reads the offset within the focused hour button and `timeFromHourOffset` snaps it. This delivers the "faixa vazia alcançável por teclado" + per-time label the ADR and frontend analysis §5 required. The docstring now states this rationale explicitly (keyboard activation lands at the focused hour's start because each hour is its own button).

### Prefill into the ADR-06 dialog — non-overlap intact

`openCreateAt(professionalId, time)` re-checks `canManageAppointments`, sets `prefill = { professionalId: professionalId ?? effectiveProfessionalId, time }` and opens the dialog; `AppointmentFormDialog` reads `prefill` and resets per open. The submit path is unchanged — `hasLocalConflict` for immediate feedback and the `tstzrange` exclusion constraint (`23P01` → `mapSchedulingError`) as the real guard. The prefill only seeds initial values; it does not bypass validation, so AC-20 non-overlap holds.

### Boundary checklist — verified no-op

Checked against the diff rather than assumed, since a frontend ADR is where a boundary violation most often slips in. No SQL, no migration, no `supabase` call outside the reused hooks, and `tenant_id` is never constructed or forwarded. Isolation stays in RLS: the calendar views consume the appointments the existing `useAppointments` query already read under the user's session, and AgendaPage reuses that same query key for list and calendars. No service-role, no secret, no webhook — idempotency/authenticity and LGPD/PII are not in play for this ADR. `AppointmentWithRelations` carries customer/service/professional, no `charges`, so no financial data reaches the tela.

### RBAC in the views

`singleColumn={!canScheduleForAnyProfessional || !!effectiveProfessionalId}` collapses the day view to one column for a `professional` (or when an admin filters to one), matching "professional vê só a própria agenda". `onOpenAppointment` and `onCreateAt` are passed only when `canManageAppointments`; a reader without manage permission gets `() => {}`/`undefined` and a read-only calendar. UI defense-in-depth over RLS, which is the correct posture.

### Timezone (AC-16)

`AppointmentBlock` formats start/end with `formatTimeInTenantTz`; `AgendaCalendarDay.minutesOfDay` positions blocks via `toTenantLocal(utcIso, timeZone)`, so a 09:00-local appointment lands at 09:00 regardless of server/browser zone. The now-line computes "today" by formatting `new Date()` through `toTenantLocal` and comparing the assembled `YYYY-MM-DD` to `day`. The week's `weekdayOf`/`shiftIsoDate` operate on the date string through `Date.UTC`, which is the tenant calendar day already (the `day` string is produced by `todayInTenantTz`), so no drift.

### Verification run (contraprova)

- `npm run build` (`tsc -b && vite build`) — clean; one pre-existing >500 kB chunk-size warning, unrelated to this ADR.
- `npm run test` (`vitest run`) — 16/16 pass (`scheduling-slots.test.ts`). No component tests exist for the new calendar files; none are required by the project convention (tests only when asked), and the live visual ACs are the QA step's job (not run here, per instructions).
- No lint script in `package.json`; typecheck + build + test are the available quality gates.

</details>

<details>
<summary>File map</summary>

- `src/app/agenda/AgendaCalendarDay.tsx` (new) — day view: hour gutter, expediente band (focused professional), now-line, proportional status-bordered blocks, per-hour keyboard-reachable empty-strip buttons.
- `src/app/agenda/AgendaCalendarWeek.tsx` (new) — week view: `sm:hidden` single arrow-navigable day on mobile + `hidden sm:block` 7-column grid on desktop; appointments only for the focused day, column click re-focuses.
- `src/app/agenda/AgendaViewToggle.tsx` (new) — segmented Lista/Dia/Semana toggle + `useAgendaView` localStorage hook (per user), arrow-key navigable, `aria-pressed`.
- `src/app/agenda/AppointmentBlock.tsx` (new) — reusable calendar block extracted from the list's visual; tenant-tz times, status border + `StatusBadge`, focusable button opening the same actions.
- `src/app/agenda/AgendaPage.tsx` (edit) — wires the toggle, renders list/day/week, adds `prefill` state + `openCreateAt`, passes `onSelectDay={setDay}` to the week.

Full diff: `git diff a45da38 86854bc`.

</details>
