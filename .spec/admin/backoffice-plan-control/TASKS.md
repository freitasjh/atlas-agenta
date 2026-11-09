# TASKS — backoffice-plan-control (TDD) — revisado PM

## BE-01 Migration + RLS (P0)
- [x] Teste: pgTAP RLS select super_admin ok / anon negado / authenticated UPDATE plan negado / UPDATE/DELETE audit negado (append-only); CHECK plan/reason 10..280; índices nominais existem (`tenant_plan_changes_tenant_idx`, partials appointments/professionals) + EXPLAIN sem seq scan.
- [x] Teste: trial default (`trial/individual`, trial_ends_at +14d); cancelado não limpa plano (status×plano ortogonais).
- [x] Implementar migration `tenant_plan_changes` + CHECK charges.plan + RLS + REVOKE.

## BE-02 RPC admin_set_tenant_plan (P0)
- [x] Teste: super_admin ok + audit insert atômico; admin negado 403; IDOR tenant forjado ignorado (usa JWT); reason curta 400; same_plan 409; tenant_not_found 404; concorrência FOR UPDATE 1 vence.
- [x] Teste NEW downgrade over-limit: 4 profs→Individual sem override → nega PLAN_LIMIT 409 + mostra uso; com override=true+motivo → aplica + `override_flag=true` auditado.
- [x] Teste NEW upgrade imediato sem validação uso (lado positivo).
- [x] Implementar RPC SECURITY DEFINER + get_tenant_plan.

## BE-03 Edge admin-plan (P0)
- [x] Teste Deno: JWT inválido 401; non-super_admin 403; must_change_password 403; zod inválido 400; RPC 409 mapeado pt-BR; sem PII log; IDOR forjado.
- [x] Teste NEW override pass-through: body `override:true` repassado à RPC; sem override + over-limit → 409 PLAN_LIMIT pt-BR.
- [x] Implementar `supabase/functions/admin-plan/` (handler+gate+schemas, molde admin-subscription).

## BE-04 Triggers enforcement (P0)
- [x] Teste: 2º prof Individual nega PLAN_LIMIT; 6º prof Clínica nega; 151º appointment Individual nega (inclui public_booking); cancelado não conta; borda mês fuso SP; Pro ilimitado.
- [x] Implementar triggers BEFORE INSERT + helpers + partial indexes.

## BE-05 Reconciliação (P1)
- [x] Teste: charge paga Pro + tenant Individual → aparece em view + badge; webhook pago não altera plan.
- [x] Implementar view `v_charges_pagas_sem_plano` + badge AssinaturasPage + runbook.

## FE-01 Dialog Trocar plano (P0)
- [x] Teste: uso acima bloqueia Confirmar; override double-confirm exibe aviso + exige motivo; motivo <10/>280 role=alert + foco; teclado total Esc retorna foco; 375px sem scroll; falha rede preserva dados + retry; sucesso toast + redirect histórico ≤2s.
- [x] Implementar Dialog 3 passos + useSetPlan (RHF+zod, shadcn, tabular-nums, alvo ≥44px).

## FE-02 Tela plano + ação lista (P0)
- [x] Teste: pending inexistente Fase 1 (sem scheduler); histórico desc com ator/data/motivo; mobile cards ação full-width; Skeleton/Empty/Error; aria-current step; contraste badges.
- [x] Implementar `/admin/tenants/:id/plano` + slot EmpresasTable.

## VAL-01 Harness (P0)
- [x] pgTAP + vitest + Deno + `npm run typecheck/build/test` 0 erro + Chrome Network 0 4xx/5xx Console 0 + screenshot + i18n pt-BR.
