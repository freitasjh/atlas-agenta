# PLAN — plan-telemetry-pacote

## Estratégia
Somente-leitura super_admin. SQL primeiro (views+RPCs+pgTAP+EXPLAIN), depois UI (hooks+cards). Sem tabela nova, sem scheduler, sem escrita.

## Fases
1. BE-01 Migration views+RPCs: 4 views security_invoker + REVOKE + 4 RPCs guard + comments + índices se EXPLAIN pedir.
2. BE-02 Parity preço: CASE espelho plans.json + pgTAP literais + CI diff (falha se divergir).
3. FE-01 Hooks + zod: usePlanMrr/useTrialConversion/useQuota/useChurn (só RPC, sem acesso direto).
4. FE-02 Cards: Dashboard MRR+quota + Métricas conversão+churn + tabela quota quente + filtros.
5. VAL-01 Harness: pgTAP + vitest + typecheck/build + Chrome + EXPLAIN p95<1s + PII grep.

## Restrições
- View nunca granted; só RPC. Guard super_admin único. search_path fixo. LIMIT 100 quota. Sem PII (email/doc). Zero-division → "—".
- TDD, multi-tenancy assert-first, RLS invoker.

## Fail modes
- Grant acidental view → pgTAP has_privilege=false falha.
- Drift preço → parity CI falha.
- Seq-scan → EXPLAIN + índice aditivo.
