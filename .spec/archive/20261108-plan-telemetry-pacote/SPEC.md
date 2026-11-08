# SPEC — plan-telemetry-pacote

## 1 Visão
Telemetria somente-leitura super_admin: 4 views + 4 RPCs + 2 cards (Dashboard MRR+quota, Métricas conversão+churn). Sem tabela nova, sem scheduler, sem escrita.

## 2 Semântica congelada (G1)
- **MRR:** `SUM(CASE plan)` só `subscription_status='ativo'`. trial/pendente/bloqueado/cancelado = 0. Preço CASE 5900/14900/25900 espelho `plans.json`. Exemplos: 2 Ind + 1 Cli ativos = 2*5900+14900.
- **Trial conversion:** coorte `tenants.created_at` mês × conversão trial→ativo via `subscription_status_changes` em 14d (fallback `trial_ends_at`). Denominador exclui trials vigentes (<14d). Taxa = convertidos/coorte.
- **Quota quente:** `tenant_plan_usage()` lógica: profs ativos vs limite; appts mês (`starts_at AT TIME ZONE coalesce(timezone,'America/Sao_Paulo')`, `status!='cancelado'`, inclui public_booking) vs limite (Individual 150). `near_limit >=80%`, `over_limit >=100%`. Ordenado % desc, LIMIT 100.
- **Churn:** numerador transições →cancelado no mês via `subscription_status_changes`; denominador base início mês (ativos+trial+cancelados). Plano no evento via `tenant_plan_changes` (não `tenants.plan` atual). Reativação não apaga churn.
- Fontes obrigatórias: `tenants` + `subscription_status_changes` + `tenant_plan_changes`. Snapshot `tenants.status` sozinho proibido.

## 3 Interfaces
- RPCs STABLE SECURITY DEFINER, search_path public, REVOKE anon/public, GRANT authenticated, guard `current_role_name()='super_admin'`:
  - `admin_get_plan_mrr(p_month 'YYYY-MM') → jsonb {mrr_cents, by_plan, base_ativa}` (null se não super_admin)
  - `admin_get_trial_conversion(p_start,p_end,p_plan?) → jsonb {coorte, convertidos, taxa}` (null)
  - `admin_get_quota_utilization(p_threshold 0.8) → table (tenant_id, trade_name, plan, profs, prof_limit, appts, appt_limit, month_key)`, vazio se não super_admin, `raise insufficient_privilege` preferido (G4)
  - `admin_get_churn_por_plano(p_month) → jsonb {by_plan:{base,churned,taxa}}` (null)
- Views `security_invoker=true`, REVOKE anon/authenticated/public, sem grant: `v_plan_mrr, v_trial_conversion_por_plano, v_quota_utilization, v_churn_por_plano`. Proibido `owner_email/phone/document` (G5 grep).
- UI: Card1 Dashboard (MRR + mix + alerta quota link âncora), Card2 Métricas (conversão + churn), filtros mês `Input month` + plano `Select PLAN_SLUGS`, tabela quota quente (Empresa|Plano|Uso|%|Status, badge warning ≥80/destructive ≥95 ícone+texto). Decisões ux-designer vinculantes (2 cards, labels visíveis, tabular-nums, aria-live, sem 0%/NaN).

## 4 Aceite
1. MRR 0 pagantes → "—" + "Sem pagantes", nunca R$0 falso/NaN.
2. Conversão denominador 0 → "—" + apoio; churn idem.
3. Quota 85% aparece badge warning + ordenação % desc.
4. Filtros alteram cards+tabela; aria-live anuncia; Tab total.
5. RPC falha → StatePanel + retry; role=alert.
6. 375px sem scroll-x página (só tabela interna); alvos ≥44px.
7. Moeda pt-BR tabular; mês America/Sao_Paulo; parity preço passa.
8. Non-super_admin → null/vazio + 403 hide nav; view direta → 42501.

## 5 Testes / Perf (G2/G3)
- pgTAP: guard anon/authenticated vazio + super_admin vê; security_invoker=true + has_privilege=false; MRR = ativos×preço; quota conta igual trigger; PII grep vazio.
- Parity: pgTAP trava 3 literais CASE + CI diff plans.json vs migration (falha se divergir) + comment fonte única.
- EXPLAIN no VERIFY; GROUP BY pré-agregado (sem LATERAL); LIMIT 100 quota; p95 <1s seed.
- Vitest: hooks/cards (MRR/conversão/churn/quota, zero-division, filtros, aria).

## 6 Delta
- ADDED: migration views+RPCs, hooks, cards, tests.
- MODIFIED: Dashboard/Métricas (2 cards).
- REMOVED: nenhum. Scheduler/previsão/CSV/drill PII = Fase 3.

## 7 Security Fase 1
STRIDE: Elevation (cross-tenant) → invoker+REVOKE+só RPC+guard; Tampering (mês/plano injetado) → validação YYYY-MM + enum; Info (PII) → sem email/doc; DoS (quota scan) → LIMIT + GROUP BY; Repudiation n/a leitura. Veredito: pass (G1..G5 viram asserts).
