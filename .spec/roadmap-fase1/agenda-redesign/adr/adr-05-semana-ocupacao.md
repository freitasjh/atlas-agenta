# ADR-05 — Semana com ocupação

- **Status:** proposta
- **Depende de:** ADR-01 (fórmulas) e ADR-02 (filtros)

## Contexto

UX-SPEC §2.4: Semana sem ocupação hoje; busca 7 dias em 1 request já existe. Mobile 1 coluna.

## Decisão

- `AgendaCalendarWeek.tsx`: cabeçalho do dia + `% ocupação` (de `computeDaySummary` por dia); grade real quando ≤3 profissionais visíveis, senão cards por dia com %; mobile 1 coluna com scroll vertical.
- Sem mudar fetch (reusa request 7-dias); cálculo client-side por dia.

## Consequências

- Pró: custo zero de backend; resolve "semana cega".
- Contra: % é intra-dia por profissional visível — documentar no tooltip.

## Escopo

- Arquivos afetados: `AgendaCalendarWeek.tsx`, `WeekDayOccupancy.tsx` (novo).
- Fora: Drawer, DnD semana, gating.

## Critérios de aceite (testáveis)

- [ ] 7 dias exibem % consistente com ADR-01 para o mesmo fixture.
- [ ] >3 profissionais → modo cards; ≤3 → grade.
- [ ] Mobile 375px 1 coluna sem overflow horizontal.
