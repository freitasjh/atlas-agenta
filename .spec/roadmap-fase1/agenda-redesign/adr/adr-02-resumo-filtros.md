# ADR-02 — ResumoDoDia + filtros (chips + popover)

- **Status:** proposta
- **Depende de:** ADR-01 (consome `computeDaySummary` + `maskFinancials`)

## Contexto

UX-SPEC §2.1/§2.2: 4 MetricCards clicáveis + linha de quick filters + chips removíveis + popover avançado. A11y já boa no repo (aria-pressed, tabular-nums). Receptionist sem R$ (Q6).

## Decisão

- `ResumoDoDia.tsx`: 4 `MetricCard` (shadcn Card) clicáveis → disparam `filterStatus`/filtro correspondente; Skeleton com `aria-busy`, erro com retry; professional filtra só própria agenda; receptionist renderiza card Previsto sem valor ("—" + sem tooltip de valor).
- `AgendaQuickFilters.tsx`: Hoje/Amanhã/Esta semana + "A confirmar" (`aria-pressed`) + view toggle existente.
- `AgendaFilterChips.tsx` + `AgendaFilterPopover.tsx` (Popover desktop / Sheet mobile): profissional, serviço/combo, status, somente pagamento pendente + badge de contagem + "Limpar tudo".

## Consequências

- Pró: hierarquia visual sem mudar shape do filtro atual (retrocompatível).
- Contra: dois componentes de filtro (rápido + avançado) exigem estado único — fonte = querystring/local state existente, sem store nova.

## Escopo

- Arquivos afetados: `src/app/agenda/ResumoDoDia.tsx`, `AgendaQuickFilters.tsx`, `AgendaFilterChips.tsx`, `AgendaFilterPopover.tsx` (novos); `AgendaPage.tsx` (fiação).
- Fora: Dia/Semana/Drawer/DnD/lote/gating.

## Critérios de aceite (testáveis)

- [ ] 4 KPIs renderizam com fixture ADR-01; clique em "A confirmar" seta `filterStatus=pendente`.
- [ ] Receptionist: nenhum "R$" no DOM (`queryByText(/R\$/i)` null).
- [ ] Chips removíveis + "Limpar tudo" zeram filtros; badge de contagem = nº filtros ativos.
- [ ] Mobile 375px: popover vira Sheet; alvos ≥44px; contraste AA.
- [ ] Console zero ERROR/WARN; teste `*.test.tsx` com Testing Library.
