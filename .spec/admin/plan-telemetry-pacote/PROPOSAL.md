# PROPOSAL — plan-telemetry-pacote

- Tipo: Feature (backoffice somente-leitura)
- Origem: confirmação "Pacote completo" (desempate 1 palavra)

## Problema
Plano é dimensão de filtro, não métrica. Sem MRR, mix, conversão trial, quota quente, churn por plano.

## Solução (architect + PM)
4 views SQL security_invoker + 4 RPCs guard super_admin + 2 cards (Dashboard MRR+quota, Métricas conversão+churn). Molde admin_dashboard_counts/usage_*. Preço via CASE plans.json + parity test. Sem tabela nova, sem scheduler, sem escrita.

## Escopo
- Entra: v_plan_mrr, v_trial_conversion_por_plano, v_quota_utilization, v_churn_por_plano + RPCs + hooks + 2 cards + filtros mês/plano.
- Fora: drill-down PII, alertas, previsão/LTV, auto cobrança/upgrade, mudança preço painel, export CSV (Should pós-MVP).

## Riscos
- Drift preço → parity test. Semântica trial/churn → definir SPEC. Fuso mês → coalesce SP. Vazamento → security_invoker + REVOKE + só RPC. Perf lateral → GROUP BY + EXPLAIN.

## Delta
- ADDED: migration views+RPCs, hooks, cards, tests pgTAP/vitest.
- MODIFIED: Dashboard/Métricas (2 cards).
- REMOVED: nenhum.
