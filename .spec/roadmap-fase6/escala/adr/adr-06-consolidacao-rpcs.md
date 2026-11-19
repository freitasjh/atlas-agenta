# ADR-06 — Consolidação no backend (RPCs por unidade: dashboard, relatórios, DRE)

- **Status**: Aceito (design congelado)
- **PRD**: §6.4 RF-24..RF-26, §7 (ledger), RNF performance (agenda ≤1,5s)
- **UX-SPEC**: §5 (`/app` agregado, relatórios comparativo, DRE em Tabs), W6/W7
- **Depende de**: ADR-02, ADR-03, ADR-04 (chave com `unitId`)
- **Bloqueia**: ADR-11 (UI de consolidação)
- **Escopo de escrita**: `supabase/migrations/`, `src/hooks/` (agregações)

## Contexto

O dashboard já agrega no banco por RPCs `SECURITY INVOKER`
(`20250224090000_dashboard_agenda_rpcs.sql`, consumidas por `useDashboardSummary`), o que
herda RLS/RBAC sem reimplementar isolamento. Faltam: recorte por unidade, quebra por unidade
no hero e sumário de agenda por unidade (nunca grade lado a lado — W6), comparativo de
relatórios e DRE por unidade. Agregar no cliente violaria o padrão e a meta de 1,5s.

## Decisão

### D1 — `p_unit_id` opcional em toda RPC existente

`dashboard_agenda_overview`, `dashboard_agenda_por_profissional`,
`dashboard_agenda_tendencia_semanal`, `financial_summary` e as RPCs de relatórios ganham
`p_unit_id uuid default null`, **aditivo** (assinatura antiga continua válida via default).
`null` = agregado do que o RLS permite. O parâmetro é recorte, não fronteira (ADR-03 D4).

### D2 — Novas RPCs de consolidação

| RPC | Retorno | Uso |
|---|---|---|
| `dashboard_units_overview(p_start, p_end)` | linhas por unidade: atendimentos, concluídos, no-show, taxa, receita do período, pendentes | bloco "Por unidade" + "Maior: X" + drill-down |
| `agenda_units_summary(p_day)` | por unidade: total, confirmados, pendentes, em atendimento, conflitos, profissionais ativos | agenda agregada em cards (nunca grade) |
| `reports_units_comparative(p_start, p_end)` | por unidade: atendimentos, ticket médio, receita, no-show, retorno | aba "Comparativo entre unidades" + CSV |
| `dre_by_unit(p_start, p_end, p_regime)` | por unidade: receita, despesa vinculada, resultado; bucket `unit_id null` = "Sem unidade" | DRE em Tabs |

Todas `SECURITY INVOKER`, `STABLE`, `set search_path = public, pg_catalog`, `revoke` de
`public`/`anon`, `grant execute` a `authenticated`. Nenhum `security definer` — agregar é
leitura e deve herdar o RLS.

### D3 — Contrato de dados e precisão

- Dinheiro em centavos inteiros (`*_cents`); nada de float.
- Receita = `sum(amount_cents)` de `appointment_payments` com `voided_at is null`, por
  `unit_id` derivado (ADR-07). Despesa = títulos com `unit_id` não nulo; o restante cai em
  "Sem unidade" (nunca rateado — ADR-07).
- Conflito/pendente no sumário vem de `appointments.status`, não de recálculo de slots.
- Período sempre em `timestamptz` UTC, bordas calculadas no frontend a partir do fuso do
  tenant (padrão `tenantRangeUtc`), como hoje.
- Unidade inativa entra no consolidado quando há dados no período; é marcada (`active=false`)
  para a UI distinguir.
- Zero double-count: a soma das linhas por unidade **não** inclui o bucket "Sem unidade";
  o total do hero é a soma dos dois (documentado no payload com `total` explícito).

### D4 — Performance e índices

Migrations adicionam índices compostos para os recortes: `appointments (tenant_id, unit_id,
starts_at)`, `appointment_payments (tenant_id, unit_id, received_at)` (parcial `voided_at is
null`), `stock_movements (tenant_id, unit_id, created_at desc)`. Meta: dashboard agregado
≤1,5s no volume de referência; nenhuma RPC faz N+1 por unidade (uma query com `group by`).

### D5 — Validação no cliente

Toda resposta é dado externo não confiável: schema zod por RPC (padrão
`useDashboardSummary`). Campo ausente/inválido degrada para estado vazio/erro — nunca derruba
a tela nem vira número inventado. `p_unit_id` enviado é sempre o do `useUnit()` (nunca
digitado).

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `p_unit_id` | `uuid default null` em todas as RPCs de agregação |
| `dashboard_units_overview` | `Array<{ unit_id, unit_name, unit_short_name, active, appointments, completed, no_show, no_show_rate, revenue_cents, pending }>` + `total` |
| `agenda_units_summary` | `Array<{ unit_id, unit_name, short_name, total, confirmed, pending, in_service, conflicts, professionals }>` |
| `reports_units_comparative` | `Array<{ unit_id, unit_name, appointments, ticket_cents, revenue_cents, no_show_rate, return_rate }>` |
| `dre_by_unit` | `Array<{ unit_id \| null, unit_name, revenue_cents, expense_cents, result_cents }>` |
| Hooks | `useUnitsOverview`, `useAgendaUnitsSummary`, `useUnitsComparative`, `useDreByUnit`; chave inclui `unitId`/período |
| Erros | RPC falha → estado de erro com retry; nunca quebra a página |

## Consequências

**Positivas**
- Consolidação explícita e barata; uma query por bloco.
- Isolamento/RBAC herdados por construção (`security invoker`).
- Comparativo e DRE compartilham o mesmo recorte de unidade do resto do app.

**Negativas / custos**
- Mais RPCs para versionar e validar com zod.
- Alterar assinatura exige cuidado com `default null` para não quebrar chamadas antigas.

**Riscos e mitigação**
- *Risco*: soma por unidade divergir do total. *Mitigação*: teste de invariante
  `total = Σ unidades + sem_unidade` para fixtures conhecidas.
- *Risco*: RPC lenta com muitas unidades. *Mitigação*: índices do D4 + teste de tempo no
  volume de referência.
- *Risco*: unidade inativa desaparecer do histórico. *Mitigação*: incluir inativas com dados
  e teste dedicado.

## Escopo

**Entra**
- Extensão aditiva das RPCs, quatro RPCs novas, índices, hooks e schemas zod, invariantes de
  soma.

**Não entra**
- Alteração da regra de receita/a receber, rateio de despesa por unidade, métricas
  consolidadas de fase 3, cache no cliente, RPC `security definer`.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20261220090000_units_aggregation_rpcs.sql` | RPCs + grants |
| `supabase/migrations/20261220091000_units_aggregation_indexes.sql` | índices |
| `src/hooks/useDashboardSummary.ts` | `p_unit_id` + bloco por unidade |
| `src/hooks/useUnitsOverview.ts` (novo) + test | hero/bloco/drill-down |
| `src/hooks/useAgendaUnitsSummary.ts` (novo) + test | sumário |
| `src/hooks/useUnitsComparative.ts` (novo) + test | comparativo |
| `src/hooks/useDre.ts` | `unitId` + por unidade |
| `src/hooks/useFinancialSummary.ts` | `p_unit_id` |

## Critérios de aceite (testáveis)

- [ ] Sem `p_unit_id`, o retorno é idêntico ao de hoje (teste de regressão de contrato).
- [ ] Com `p_unit_id`, só a unidade pedida aparece; unidade sem permissão → vazio, não erro.
- [ ] `total = Σ unidades + sem_unidade` em todas as RPCs que expõem total.
- [ ] Unidade inativa com dados no período aparece marcada `active=false`.
- [ ] Agenda agregada retorna **contadores**, nunca blocos de grade.
- [ ] Dashboard agregado responde dentro da meta no dataset de referência.
- [ ] Resposta inválida (fixture suja) degrada para erro/vazio sem quebrar a tela.

## Dependência / ordem

Depois de ADR-02 (coluna `unit_id` no ledger já derivada) e ADR-03 (helpers/RLS). Em paralelo
com ADR-05/07; as regras financeiras de `unit_id` (imutabilidade, receita/a receber, bucket
"Sem unidade") são consolidadas em ADR-07 antes da UI financeira (ADR-11).
