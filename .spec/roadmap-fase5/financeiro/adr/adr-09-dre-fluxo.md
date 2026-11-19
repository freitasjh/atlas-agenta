# ADR-09 — DRE + fluxo de caixa (RPCs + UI + CSV)

- **Status**: `proposed`
- **Depende de**: ADR-06 + ADR-07 + ADR-08 (consome payables/receivables/ledger/conciliados).
- **RFs**: RF-27, RF-28, RF-29, RF-30, RF-31.

## Contexto

Decisão por números: DRE competência/caixa (Receitas − Custos = Margem − Despesas = Resultado; avulsas categoria própria; gorjeta fora), gráficos 6m + tabela alternativa, fluxo 30d + saldo acumulado, export CSV. PRD §10.9–10.10 abertas (competência receita, recorrência no DRE).

## Decisão

- RPCs admin-only RLS: `dre_report(tenant, ini, fim, regime)` — Receitas = ledger (received_at caixa / starts_at competência) + avulsas recebidas categoria própria; Custos = comissões concluídos; Despesas = payables pagos; gorjeta excluída em todos os regimes.
- `cashflow_30d(tenant, base)` — diário recebido vs pago + saldo acumulado.
- Decisões provisórias §10: competência receita = `starts_at` do atendimento; avulsas em grupo próprio "Receitas avulsas"; recorrência membership paga entra como receita avulsa-categoria `recorrencia` (sem duplo-contar ledger).
- UI `/app/financeiro/dre` (admin-only, `dreFluxo`): Segmented competência/caixa + PeriodFilter; tabela DRE; barras 6m + linha saldo + tabela alternativa (a11y); fluxo 30d; export CSV + log (tabela `export_logs` criada aqui se ADR-10 ainda não rodou — dono: este ADR cria `export_logs`, ADR-10 só consome).
- `export_logs`: `id, tenant_id, tipo, periodo, formato, arquivo_path, created_by, created_at`.

## Consequências

- Positivas: DRE auditável e reconciliável com ledger; CSV imediato para contador.
- Negativas: sem rateio de custos fixos por categoria neste MVP.

## Escopo

- Entra: 2 RPCs + `export_logs` + UI + CSV + gating.
- Não entra: export SPED/OFX (ADR-10), back-office métricas (ADR-11).

## Arquivos afetados

- `supabase/migrations/*_dre_fluxo.sql` (RPCs + export_logs + RLS)
- `src/app/financeiro/dre/*`, `src/hooks/useDre.ts`

## Critérios de aceite (testáveis)

1. Fixtures: DRE caixa bate `sum(ledger)+avulsas−comissões−pagos`; gorjeta excluída (assert com tip).
2. Competência usa `starts_at`; 6m barras somam = tabela; fluxo acumulado fecha com saldo final.
3. Tabela alternativa contém mesmos números dos gráficos (a11y); CSV baixa + grava `export_logs`.
4. Gating `dreFluxo=false/null` → upsell sem RPC; RLS cross 0.
