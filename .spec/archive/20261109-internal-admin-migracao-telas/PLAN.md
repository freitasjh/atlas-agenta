# PLAN — internal-admin-migracao-telas (revisado PM)

## Estratégia
Backend primeiro (ADR-02 prova operador+AAL2), depois shell, depois move por tela, depois deleção. `git mv` preserva histórico. Dual-mount breve p/ QA comparativo (legado read-only, 1 release).

## Fases
1. BE-01 helper `is_active_internal_operator()` SECURITY DEFINER + `REVOKE anon/public` + `GRANT authenticated` + `search_path` fixo + pgTAP.
2. BE-02 Edges 02a (`admin-subscription`, `invite-member`, `resend-invitation`, `revoke-invitation`): verifyInternalOperator primeiro + AAL2 de sessão exigida por request, service_role, ignora `profiles.role`, must_change nega, log ator/alvo sem PII (IP apenas como hash, sem telefone/documento). Convites: body `tenant_id` obrigatório. RPCs agregados com LIMIT 100 + filtros temporais onde aplicável.
3. BE-03 RPCs 02b — lista fechada: `admin_dashboard_counts`, `admin_dashboard_disconnected_whatsapp`, `admin_usage_overview`, `admin_usage_series`, `admin_usage_tenants`, `admin_get_plan_mrr`, `admin_get_trial_conversion`, `admin_get_quota_utilization`, `admin_get_churn_por_plano`, `admin_get_plan_divergences`, `admin_get_tenant_plan`, `admin_get_tenant_usage`. `OR is_active_internal_operator()`; RLS tenant NO TOUCH (catálogo prova). Nunca `super_admin` ao operador.
4. BE-04 Auditoria append-only: Edge write (sem update/delete), `voided_at` se correção; métrica `internal_admin_denies_total` (deny logado mesmo padrão).
5. FE-01 InternalShell: `md:grid-cols-[16rem_1fr]`, 6 links sidebar + Sair, `max-w-5xl`, `aria-label="Administração interna"`, foco h1, skip-link. `InternalAdminLayout max-w-md` SÓ login/mfa/enroll. Rotas sob RequireInternalOperator; índice → redirect empresas (= InternalHomePage como redirect, não placeholder). `mfa_required` → /mfa.
6. FE-02 Move Empresas + TenantPlano (+dialogs) + back-link `/internal-admin/empresas`; dual-mount QA.
7. FE-03 Move Assinaturas + Métricas/telemetria + dashboard (KPIs reais das RPCs 02b; `null`→skeleton/empty "—", nunca quebra) + Convites + Auditoria (filtros + lista actor/ação/alvo/data) + testes.
8. FE-04 Redirect `Navigate /admin/* → /internal-admin/*` (release 1, SPA) + fase 2: 410 + delete bloco/AdminLayout/Sidebar/links/imports/`useAdmin*` órfãos; atualizar testes nomeados (`useAdminTenants.test`, `passwordGate.test`, `resolvePostLoginDestination.test`, `plan-telemetry-parity.test`) + docs que citam `/admin`; login pós-migração sem loop (`POST_LOGIN_SUPER_ADMIN`, `resolvePostLoginDestination`).
9. VAL-01 Harness: pgTAP + Deno + vitest + typecheck/build 0 + Chrome paridade <1% + Console 0 + Rede 0 4xx/5xx + 1280/375 sem scroll-x + BOLA 3 sentidos enumerados + denies_total lido via log estruturado + redirect map 8 pares + EXPLAIN sem seq-scan + grep sem .from + i18n.

## Restrições
- Nenhuma policy tenant tocada; nenhuma claim como prova (`super_admin` ao operador proibido); resposta inalterada; pt-BR/tabular; log sem PII.
- TDD teste-antes. RLS assert-first.

## Fail modes
- Tela vazia/403 pós-move → ADR-02 incompleto; voltar p/ BE.
- BOLA aberto → bloqueia archive.
