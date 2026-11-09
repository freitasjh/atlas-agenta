# SPEC — backoffice-plan-control

## 1 Visão
Troca de plano auditada no backoffice (`tenants.plan` SSoT) + enforcement básico de limites. Status continua via `admin-subscription`; plano ganha canal próprio `admin-plan`.

## 2 Decisões congeladas (Fase 1)
- **G1 RPC vs guard:** Edge `admin-plan` + RPC `admin_set_tenant_plan` service_role-only (espelha `admin-subscription`). `REVOKE authenticated/anon` na RPC. Ator do JWT no servidor.
- **G2 Scheduler:** CORTADO Fase 1. Sem `effective_date` agendada, sem `pending_plan`, sem pg_cron. Upgrade e downgrade = imediato + grandfather (dados excedentes preservados, só bloqueia novos creates). Scheduler vira Fase 3.
- **G3 Enforcement DB:** triggers `BEFORE INSERT` fail-closed (não só helper UI). Mês = `date_trunc('month', starts_at AT TIME ZONE tenants.timezone)`. Contam appointments `status != 'cancelado'`; profissionais `active=true`. `public_booking` entra no mesmo gate.
- **G4 charge.plan:** MANTER coluna `plan` (intenção, nunca aplica sozinha). Add `CHECK plan in (...)` + comment. Sem rename para `desired_plan`.
- **G5 Webhook:** continua status-direto (débito conhecido). Nunca toca `tenants.plan`. Reconciliação via view `v_charges_pagas_sem_plano` + badge em AssinaturasPage + runbook manual.
- **G6 reason/409:** `reason` CHECK `char_length 10..280` DB + zod Edge + Dialog. `FOR UPDATE` + `raise exception reason_too_short / tenant_not_found` → Edge traduz 400/404/409.

## 3 Regras negócio (RB-01..09 adaptadas sem scheduler)
- Planos: Individual (1 prof, 150 agend/mês, 5900), Clínica (5 prof, ∞, 14900), Pro (∞ prof, ∞ + relatórios, 25900). Preço informativo.
- Upgrade imediato sem validação uso. Downgrade imediato grandfather: aplica limite novo na hora, dados acima preservados, novos creates bloqueados `PLAN_LIMIT`.
- Downgrade acima uso exige `override + motivo` (double-confirm, auditado).
- Trial: nasce `trial/individual`, `trial_ends_at = created +14d`. Vencido → `bloqueado` (job Fase 3; Fase 1 manual via Dialog).
- Status × plano ortogonais. `cancelado` não limpa plano.
- Auditoria append-only `tenant_plan_changes`, sem update/delete.

## 4 Interfaces
- RPC: `admin_set_tenant_plan(p_tenant_id uuid, p_new_plan text, p_changed_by uuid, p_reason text) → (old_plan,new_plan)`. SECURITY DEFINER, search_path public, REVOKE.
- Edge `admin-plan`: POST `{tenantId, plan, reason, override?}` → 200/400/401/403/404/409 pt-BR. resolveIdentity JWT + gate super_admin + must_change_password.
- UI: Dialog 3 passos (Uso → Destino+motivo → Preview diff) — decisões ux-designer vinculantes. Tela `/admin/tenants/:id/plano`: plano atual + uso + histórico. Tabela Empresas + ação Trocar plano (desktop + cards mobile).
- Erros: `PLAN_LIMIT` 403 pt-BR ("Limite do plano Individual: ..."), `reason_too_short`, `same_plan`.

## 5 Aceite (Given/When/Then)
1. Upgrade Individual→Clínica com motivo ≥10 → plan novo imediato, histórico inserido, próxima criação 2º prof permite.
2. Downgrade Clínica(4 profs)→Individual sem override → nega `PLAN_LIMIT` + mostra uso.
3. Downgrade com override+motivo → aplica + `override_flag=true`.
4. Individual com 150 agend mês cria 151º (inclui public_booking) → nega 403 `PLAN_LIMIT`.
5. `reason <10` → 400 pt-BR, sem write.
6. admin tenant tenta RPC direto → 403. tenant_id forjado ignorado.
7. UX: uso acima limite bloqueia Confirmar antes passo 3; motivo inválido role=alert + foco; teclado total; 375px sem scroll horizontal; toast aria-live + histórico topo ≤2s.
8. Webhook pago não toca plan (teste: charge pago Pro + tenant Individual → plan segue Individual + badge divergência).

## 6 Testes / RLS / Índices
- RPC IT: super_admin ok, admin negado, reason curta, same_plan, concorrência FOR UPDATE, tenant_not_found.
- Trigger IT: 2º prof Individual nega, 151º appointment nega, cancelado não conta, fuso mês borda, public_booking nega.
- RLS: `tenant_plan_changes` select super_admin only, zero write client; `tenants UPDATE(plan)` negado authenticated.
- Índices: `tenant_plan_changes(tenant_id, created_at desc)`, partial `appointments(tenant_id, starts_at) WHERE status != 'cancelado'`, `professionals(tenant_id) WHERE active`.

## 7 Delta Specs
- ADDED: `tenant_plan_changes`, RPC + Edge `admin-plan`, Dialog Trocar plano, tela plano, view reconciliação, `get_tenant_plan`.
- MODIFIED: `EmpresasTable` (ação), `AssinaturasPage` (badge divergência), `subscription_charges.plan` (CHECK + comment).
- REMOVED: nenhum. Scheduler/pending_plan/prorata = Fase 3.

## 8 Security (Fase 1)
STRIDE: Elevation (IDOR troca alheia) → Edge super_admin + RPC service_role; Tampering (plan forjado) → CHECK + zod + RLS; Info Disclosure (reason PII) → min/max + sem telefone/documento + não loga PII; DoS (contagem mensal scan) → partial index; Repudiation → changed_by JWT + audit imutável.
Veredito: pass com G1..G6 congelados (0 🔴 aberto).
