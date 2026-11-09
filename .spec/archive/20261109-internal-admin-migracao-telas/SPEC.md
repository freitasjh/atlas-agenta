# SPEC — internal-admin-migracao-telas (8 rotas, legado removido)

## 1 Visão
Mover 8 rotas `/admin/*` → `/internal-admin/*` sob `RequireInternalOperator` + `InternalShell` novo; deletar bloco `/admin`, `AdminLayout/Sidebar`, links e órfãos. Zero feature/redesign — paridade 1:1 (parecer ux-designer vinculante).

## 2 Escopo fechado (G1)
Rotas destino `/internal-admin/{empresas, tenants/:id/plano, assinaturas, metricas, dashboard, convites, auditoria}` + índice → redirect `empresas` (igual `/admin` hoje). `InternalHomePage` vira hub/redirect, não placeholder. `TenantPlanoPage` explícita (back-link ajustado p/ `/internal-admin/empresas`).

## 3 ADR-02 backend executável (BLOQUEANTE, G2)
- **02a Edges (writes):** `admin-subscription`, `invite-member`, `resend-invitation`, `revoke-invitation` chamam `verifyInternalOperator(service, jwt)` primeiro; OK → executam com `service_role`, ignoram `profiles.role`; `must_change_password=true` continua negando; log `actor=user_id, edge, target_tenant` sem PII (G10: mesmo padrão nas RPCs tocadas + métrica `internal_admin_denies_total`).
- **02b RPCs (reads agregados):** `admin_dashboard_*`, `admin_usage_*`, `admin_get_plan_*`, `admin_get_plan_mrr/trial_conversion/quota_utilization/churn_por_plano/divergences/tenant_plan` ganham `OR is_active_internal_operator()` via helper novo `is_active_internal_operator() SECURITY DEFINER` (`REVOKE anon/public`, `GRANT authenticated`, `search_path` fixo). RLS de tenant **intocada** (NO TOUCH).
- **Proibido:** claim `is_operator` como prova (só hint UX); afrouxar RLS tenant; `super_admin` ao operador (recria o risco).
- **Convites (G5):** body `tenant_id` obrigatório + log ator/alvo; sem tenant implícito.
- **Auditoria (G6):** operador escreve via Edge (append-only; `voided_at` se correção); tela lista actor/ação/alvo/data.
- **Dashboard (G7):** monta KPIs das RPCs 02b; `null` → skeleton/empty "—", nunca quebra.
- **Login pós-migração (G9):** `POST_LOGIN_SUPER_ADMIN` + `resolvePostLoginDestination` + `passwordGate` apontam `/internal-admin/empresas`; operador sem AAL2 nunca cai em loop.

## 4 Frontend (G3/G4/G8)
- `git mv src/admin/{empresas,tenants,assinaturas,metricas,dashboard,convites,auditoria} → src/internal-admin/...` (preserva histórico).
- `InternalShell` novo: `md:grid-cols-[16rem_1fr]`, sidebar 6 links + Sair, `max-w-5xl`, `aria-label="Administração interna"`, foco no `h1` por rota, skip-link. `InternalAdminLayout max-w-md` fica SÓ p/ login/mfa/enroll.
- Redirect 1 release: `Navigate /admin/* → /internal-admin/*`; depois 410/delete. `TenantPlanoPage` back-link atualizado.
- Deletar: bloco `/admin` router, `AdminLayout/Sidebar/pages.tsx`, `Navigate`, links, imports, `useAdmin*` órfãos; atualizar `useAdminTenants.test`, `passwordGate.test`, `resolvePostLoginDestination.test`, `plan-telemetry-parity.test` (G8), docs que citam `/admin`.
- Dual-mount breve p/ QA comparativo (legado read-only) antes do delete.

## 5 Aceite
1. 8 rotas navegam como operador AAL2, mesmos dados/textos/estados do legado (paridade <1% diff).
2. Console 0, Rede 0 4xx/5xx, 1280 + 375px (tabela→cards, sem scroll-x corpo).
3. BOLA: tenant → `/internal-admin/*` 403; operador sem AAL2 nega; RLS tenant inalterada.
4. Deep-link `/admin/X` redireciona (release 1); `/internal-admin` index → empresas.
5. Zero `.from(` tenant cross-tenant em `src/internal-admin`; grep prova.
6. Testes atualizados verdes; parity test passa no novo path.

## 6 Testes
- pgTAP: helper novo guard + regressão RPCs (operador vê, anon nega, tenant nega); RLS tenant inalterada (policies intactas).
- Deno: Edges 02a (operador+AAL2 passa, sem AAL2 nega, não-operador nega, must_change bloqueia).
- Vitest: telas movidas (mesmos testes, path novo) + guard + shell + redirect.
- E2E: paridade lado a lado + BOLA ambos sentidos + redirect map completo.

## 7 Segurança Fase 1: pass
STRIDE: Spoofing (operador sem MFA) → RequireInternalOperator + verify por request; Tampering (tenant_id forjado) → ignorado, prova é JWT+AAL2 server-side; Repudiation → audit actor/ação/alvo/IP; Info → sem PII em log, negação 401/403 única anti-enumeração; DoS → LIMIT 100 + filtros temporais; Elevation → RLS tenant intocada, writes só Edge+AAL2. Veredito: pass (0 🔴; G10 vira assert).

## 8 Delta Specs
- ADDED: InternalShell, rotas internas, helper is_active_internal_operator, ADR-01..05.
- MODIFIED: router, gates/hook recusa sem operador+AAL2, RPCs 02b, convites body tenant_id, testes, parity, docs.
- REMOVED: bloco /admin, AdminLayout/Sidebar, RequireRole super_admin, policies legadas (F1-drop datado).
