# Design QA — Schedule prototype

**final result: passed**

## Comparison target

- Source visual truth: `/home/joao/fusionlf/wsProjeto/atlas-agenda/harness/adr-08-agenda-lista-1280.png`
- Implementation screenshot: `/tmp/schedule-prototype-1280-v3.png`
- Combined comparison input: `/tmp/schedule-comparison-v3.png`
- Viewport: 1280 × 800 CSS px
- Source pixels: 1280 × 800, density 1
- Implementation pixels: 1280 × 800, density 1
- Normalization: none required for fidelity judgment; the combined comparison was displayed at 960 × 600 per side.
- State: dark theme, `Dia` view, `12/11/2026`, no filters applied, no dialog open.

## Evidence

### Full view

The source and implementation were placed side by side in the same image. Overall composition, sidebar width, content inset, header, metric cards, quick filters, view toggle, filters button, and schedule panel position align closely at the same viewport.

### Focused regions

- Header and metrics: title size, subtitle, action buttons, four-card grid, labels, values, support text, and card height match the source within a few pixels.
- Filter row: `Ir para data` label, date stepper, quick buttons, and `Lista · Dia · Semana` segment align on the same baseline and order.
- Schedule: professional header, 09:00–14:00 hour labels, grid rhythm, appointment block heights, green borders, and status pills match the source positions.
- Typography: Inter-family UI text, Space Grotesk-style numeric display, and JetBrains Mono-style time labels match the source hierarchy.
- Colors: dark slate background/cards, jade primary, muted text, and borders match the sampled source palette.
- Copy: all visible pt-BR labels match the source.

## Findings

No actionable P0, P1, or P2 findings.

### Open questions

- The source screenshot renders appointment text almost invisible, while the application code intends `text-foreground` for that content. The prototype keeps the text legible; this is treated as an intentional accessibility-preserving deviation, not a mismatch to fix.

### Follow-up polish (P3)

- The source capture shows a visible internal scrollbar in the timeline; the QA capture used a browser flag that hides scrollbars. The prototype itself keeps native scrolling.

## Comparison history

### Iteration 1

Earlier findings:

- [P2] Missing `Ir para data` label above the date controls.
- [P2] Metric cards were 8px shorter than the source.
- [P2] Filter row and schedule panel were shifted upward.
- [P1] `Hoje` appeared active even though the displayed date was not the current date.
- [P2] View toggle was right-aligned instead of following the quick filters.

Fixes made:

- Added the `Ir para data` label and a grouped date control.
- Raised metric card min-height to 126px.
- Increased filter-footer and schedule spacing.
- Introduced fixed `TODAY_ISO`/`TOMORROW_ISO` values so `Hoje` reflects the current prototype date.
- Removed the automatic left margin from the view toggle.

Post-fix evidence: `/tmp/schedule-prototype-1280-v3.png` and `/tmp/schedule-comparison-v3.png`.

## Verification notes

- `npm run build` passed.
- `npm run test:sites` passed (1/1).
- The local Vite preview served the application at `http://127.0.0.1:4173/`.
- Browser-rendered visual verification used headless Chrome because the in-app browser and paired browser extension were unavailable in this environment.
