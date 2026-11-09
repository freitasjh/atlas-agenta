# PLAN — backoffice-plan-control

## Estratégia
Backend-first (RPC + triggers + Edge) antes de UI. Sem scheduler Fase 1. `tenants.plan` SSoT, `tenant_plan_changes` audit, Edge `admin-plan` service_role-only, enforcement via triggers BEFORE INSERT fail-closed.

## Fases
1. BE-01 Migration `tenant_plan_changes` + CHECK `subscription_charges.plan` + comment + índices partial + RLS (select super_admin, zero write client) + `REVOKE UPDATE(plan)` authenticated.
2. BE-02 RPC `admin_set_tenant_plan` (SECURITY DEFINER, FOR UPDATE, reason 10..280, errors tenant_not_found/invalid_plan/same_plan/reason_too_short) + `get_tenant_plan` + `REVOKE`.
3. BE-03 Edge `admin-plan` (resolveIdentity JWT, gate super_admin + must_change_password, zod, traduz RPC→409/400/403/404 pt-BR, sem PII log).
4. BE-04 Enforcement triggers: `check_professional_limit` (active=true count vs PLAN_LIMITS) + `check_appointment_quota` (mês por starts_at AT TIME ZONE timezone, status != cancelado, inclui public_booking) → `PLAN_LIMIT` pt-BR. Partial indexes + EXPLAIN.
5. BE-05 Reconciliação: view `v_charges_pagas_sem_plano` + badge AssinaturasPage (sem auto-aplicar plan).
6. FE-01 Dialog Trocar plano 3 passos (Uso → Destino+motivo → Preview) + hook useSetPlan + zod + role=alert + toast.
7. FE-02 Tela `/admin/tenants/:id/plano` (atual + uso + histórico) + ação EmpresasTable (desktop + cards mobile, bottom-sheet <640px).
8. VAL-01 Harness: pgTAP RPC/trigger/RLS + vitest Dialog + Deno Edge tests + Chrome (Network/Console/screenshot) + i18n pt-BR.

## Restrições
- Sem UPDATE direto `tenants.plan` client; sem `service_role` browser; sem scheduler/pending_plan; webhook nunca toca plan.
- TDD: teste antes implementação em toda task. Multi-tenancy assert-first.

## Fail modes
- RPC negada pelo guard → congelado G1 (Edge service_role).
- Contagem sem índice → seq scan; exige EXPLAIN.
- Fuso mês errado → trunc com timezone tenant.
- Downgrade over-limit sem override → nega; com override → aplica + flag.
