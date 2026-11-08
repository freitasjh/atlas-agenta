# TASKS — plan-telemetry-pacote (TDD)

## BE-01 Views+RPCs (P0)
- [x] Teste pgTAP: guard anon/auth vazio + super_admin vê; security_invoker=true + sem privilege view; MRR ativos×preço; quota = trigger; PII grep vazio; EXPLAIN sem seq-scan.
- [x] Implementar migration 4 views + 4 RPCs + revokes + comments + LIMIT 100 + RAISE insufficient_privilege quota + validação server-side YYYY-MM/enum + fontes audit obrigatórias (sem snapshot tenants.status).

## BE-02 Parity preço (P0)
- [x] Teste: pgTAP trava 5900/14900/25900 no CASE; CI diff plans.json vs migration; vitest parity.
- [x] Implementar comment fonte única + script CI.

## FE-01 Hooks (P0)
- [x] Teste: hooks chamam só RPC; zero-division "—"; filtros mês/plano; erro retry; aria-live resumo.
- [x] Implementar hooks + zod schemas (só RPC).

## FE-02 Cards + tabela (P0)
- [x] Teste: MRR pt-BR tabular; quota 85% badge warning ordenado; conversão/churn "—" sem denominador; 375px sem scroll-x página; Tab total; foco visível; contraste.
- [x] Implementar Card1 Dashboard + Card2 Métricas + tabela quota (badge warning ≥80/destructive ≥95 ícone+texto, link âncora) + filtros + hide nav 403 + role=alert + alvos ≥44px + sem NaN.

## VAL-01 Harness (P0)
- [x] pgTAP + vitest + typecheck/build 0 + Chrome 0 erro/rede 0 4xx + screenshots + EXPLAIN p95<1s + i18n pt-BR.
