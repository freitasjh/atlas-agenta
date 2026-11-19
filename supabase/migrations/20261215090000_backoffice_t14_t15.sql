-- Migration: ADR-11 — back-office T1.4/T1.5 (aba Operação + suspender/retomar + MRR/churn/NFCe).
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Escopo (ADR-11, PRD §6.7 RF-32..35):
--   1. `backoffice_subscriptions()` — assinaturas membership cross-tenant para a aba
--      Operação (inadimplência destacada). Tabelas `membership_*` só têm policy de
--      `admin` do próprio tenant; o caminho cross-tenant é RPC SECURITY DEFINER com
--      guard interno de `super_admin` (PRD §7: cross-tenant só no back-office, auditado).
--   2. `mrr_report()` — MRR **SaaS atual**: tenants ativos × preço do plano no
--      catálogo SSoT (`plans`), como snapshot do instante da chamada (não há
--      série histórica por mês; o nome `report` não promete mês). Reusa
--      `v_plan_mrr`/`plan_price_cents`.
--   3. `membership_mrr_churn(p_from, p_to)` — MRR **membership** (recorrente do
--      cliente final, normalizado mensal) + churn de assinaturas canceladas no
--      período. Decisão PRD §10.14: SaaS ≠ membership, **nunca somados** — cada
--      RPC devolve `kind` próprio (`saas` | `membership`) e a UI nunca agrega.
--   4. `nfce_volume(p_from, p_to)` — NFCe autorizadas/contingência/rejeitadas/
--      canceladas por período (ADR-02 `fiscal_documents`).
--
-- Decisão PRD §10.13: suspensão **manual** neste MVP (débito: automação futura).
-- Suspender/retomar usa o caminho já auditado da plataforma: Edge Function
-- `admin-subscription` → RPC `admin_set_subscription_status` →
-- `subscription_status_changes` (autor + motivo). Nenhum caminho novo de escrita de
-- `tenants.subscription_status` nasce aqui; o guard `tenants_guard_privileged_columns`
-- continua barrando escrita pelo cliente e o trilho continua sendo
-- `subscription_status_changes` (leitura RLS super_admin).
--
-- Guard de papel: as 4 RPCs são super-admin-only, com a MESMA porta dupla das RPCs
-- internas (migracao_telas/BE-03): `role = super_admin` OU operador interno ativo
-- (`is_active_internal_operator()`, auth.uid em `internal_operators`). Diferente das
-- RPCs de telemetria legadas (que devolvem `null`), aqui o papel errado recebe
-- `PT403` (ADR-11 aceite 3: "não-super-admin → 403 + RLS nega"); superfície de
-- operação não deve falhar em silêncio. O helper não é prova isolada no cliente:
-- AAL2 é exigido server-side na Edge Function.
--
-- Convenções: inglês/snake_case/plural; dinheiro em `*_cents` inteiro; tempo em
-- timestamptz UTC; `security definer` + `search_path` fixo; erros de domínio com
-- `errcode` PT4xx (PostgREST → HTTP 4xx). Nenhum segredo no SQL.

-- ============================================================================
-- 1) backoffice_subscriptions — assinaturas membership cross-tenant (aba Operação).
--    Ordena inadimplentes primeiro; valor/vencimento vêm do plano e das cobranças.
-- ============================================================================
create or replace function public.backoffice_subscriptions()
returns table (
  tenant_id            uuid,
  tenant_name          text,
  subscription_id      uuid,
  customer_name        text,
  plan_name            text,
  billing_period       text,
  amount_cents         int,
  status               text,
  next_charge_at       timestamptz,
  overdue_charges      int,
  overdue_amount_cents bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  return query
    select s.tenant_id,
           coalesce(nullif(btrim(t.trade_name), ''), t.legal_name) as tenant_name,
           s.id as subscription_id,
           c.name as customer_name,
           p.name as plan_name,
           p.billing_period,
           p.amount_cents,
           s.status,
           s.next_charge_at,
           coalesce(o.overdue_charges, 0)::int as overdue_charges,
           coalesce(o.overdue_amount_cents, 0)::bigint as overdue_amount_cents
      from public.membership_subscriptions s
      join public.tenants t
        on t.id = s.tenant_id
      join public.membership_plans p
        on p.tenant_id = s.tenant_id and p.id = s.plan_id
      join public.customers c
        on c.tenant_id = s.tenant_id and c.id = s.customer_id
      left join (
        select ch.tenant_id,
               ch.subscription_id,
               count(*) filter (where ch.status = 'vencido')::int as overdue_charges,
               coalesce(sum(ch.amount_cents) filter (where ch.status = 'vencido'), 0)::bigint
                 as overdue_amount_cents
          from public.membership_charges ch
         group by ch.tenant_id, ch.subscription_id
      ) o
        on o.tenant_id = s.tenant_id and o.subscription_id = s.id
     order by (s.status = 'inadimplente') desc,
              s.next_charge_at nulls last,
              tenant_name;
end;
$$;

comment on function public.backoffice_subscriptions() is
  'Back-office T1.4 (ADR-11): assinaturas membership cross-tenant para a aba Operacao. '
  'SECURITY DEFINER com guard super_admin OU operador interno ativo (PT403 para os demais papeis). '
  'Somente leitura; '
  'ordenado com inadimplentes primeiro. Nenhum segredo.';

revoke all on function public.backoffice_subscriptions() from public, anon;
grant execute on function public.backoffice_subscriptions() to authenticated, service_role;

-- ============================================================================
-- 2) mrr_report — MRR SaaS ATUAL (tenants ativos × preço do catálogo). kind = 'saas'.
--    Sem parâmetro de mês: é um snapshot do instante, não uma série histórica
--    (o catálogo/estado do tenant não guardam versão por mês). A UI rotula "atual".
-- ============================================================================
create or replace function public.mrr_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mrr     bigint;
  v_base    int;
  v_by_plan jsonb;
begin
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select coalesce(sum(public.plan_price_cents(t.plan))::bigint, 0),
         count(*)::int
    into v_mrr, v_base
    from public.tenants t
   where t.subscription_status = 'ativo';

  select coalesce(
           jsonb_object_agg(plan, jsonb_build_object('base', base_ativa, 'mrr_cents', mrr_cents)),
           '{}'::jsonb
         )
    into v_by_plan
    from public.v_plan_mrr;

  return jsonb_build_object(
    'kind', 'saas',
    'as_of', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'mrr_cents', v_mrr,
    'base_ativa', v_base,
    'by_plan', v_by_plan
  );
end;
$$;

comment on function public.mrr_report() is
  'Back-office T1.5 (ADR-11): MRR SaaS ATUAL = SUM(tenants ativos x preco do plano no catalogo), '
  'snapshot do instante da chamada (sem parametro de mes e sem serie historica). '
  'kind=saas: NUNCA somado ao MRR de membership (membership_mrr_churn, kind=membership). '
  'SECURITY DEFINER com guard super_admin OU operador interno ativo (is_active_internal_operator). '
  'Nenhum segredo.';

revoke all on function public.mrr_report() from public, anon;
grant execute on function public.mrr_report() to authenticated, service_role;

-- ============================================================================
-- 3) membership_mrr_churn — MRR membership (mensal normalizado) + churn do período.
--    kind = 'membership'. Cancelamento lido do audit_log (membership_update_status).
-- ============================================================================
create or replace function public.membership_mrr_churn(
  p_from date,
  p_to   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mrr            bigint;
  v_risco          bigint;
  v_ativas         int;
  v_inadimplentes  int;
  v_pausadas       int;
  v_canceladas     int;
  v_base           int;
begin
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'INVALID_RANGE' using errcode = 'PT400';
  end if;

  -- MRR = assinatura ativa, normalizada para mês (mensal 1x, trimestral /3, anual /12).
  select coalesce(sum(
           case p.billing_period
             when 'mensal'     then p.amount_cents::numeric
             when 'trimestral' then p.amount_cents::numeric / 3
             when 'anual'      then p.amount_cents::numeric / 12
             else 0
           end
         )::bigint, 0)
    into v_mrr
    from public.membership_subscriptions s
    join public.membership_plans p
      on p.tenant_id = s.tenant_id and p.id = s.plan_id
   where s.status = 'ativa';

  -- Em risco: inadimplente segue contratualmente recorrente, mas não entra no MRR.
  select coalesce(sum(
           case p.billing_period
             when 'mensal'     then p.amount_cents::numeric
             when 'trimestral' then p.amount_cents::numeric / 3
             when 'anual'      then p.amount_cents::numeric / 12
             else 0
           end
         )::bigint, 0)
    into v_risco
    from public.membership_subscriptions s
    join public.membership_plans p
      on p.tenant_id = s.tenant_id and p.id = s.plan_id
   where s.status = 'inadimplente';

  select count(*) filter (where s.status = 'ativa')::int,
         count(*) filter (where s.status = 'inadimplente')::int,
         count(*) filter (where s.status = 'pausada')::int
    into v_ativas, v_inadimplentes, v_pausadas
    from public.membership_subscriptions s;

  -- Churn: assinaturas canceladas DENTRO do período (evento auditado).
  select count(distinct a.target_id)::int
    into v_canceladas
    from public.audit_log a
   where a.action = 'membership_status_changed'
     and a.target_type = 'membership_subscription'
     and a.metadata->>'to_status' = 'cancelada'
     and a.created_at >= p_from::timestamptz
     and a.created_at < (p_to + 1)::timestamptz;

  -- Base de início: assinaturas criadas antes do período e não canceladas antes dele.
  select count(*)::int
    into v_base
    from public.membership_subscriptions s
   where s.created_at < p_from::timestamptz
     and not exists (
       select 1
         from public.audit_log a
        where a.action = 'membership_status_changed'
          and a.target_type = 'membership_subscription'
          and a.target_id = s.id
          and a.metadata->>'to_status' = 'cancelada'
          and a.created_at < p_from::timestamptz
     );

  return jsonb_build_object(
    'kind', 'membership',
    'from', p_from,
    'to', p_to,
    'mrr_cents', v_mrr,
    'mrr_em_risco_cents', v_risco,
    'ativas', v_ativas,
    'inadimplentes', v_inadimplentes,
    'pausadas', v_pausadas,
    'canceladas_periodo', v_canceladas,
    'base_inicio', v_base,
    'churn_pct', case when v_base = 0 then null
                      else round(v_canceladas::numeric * 100.0 / v_base, 2) end
  );
end;
$$;

comment on function public.membership_mrr_churn(date, date) is
  'Back-office T1.5 (ADR-11): MRR membership normalizado mensal (mensal 1x, trimestral /3, '
  'anual /12) + churn de canceladas no periodo (audit_log). kind=membership: NUNCA somado '
  'ao MRR SaaS (mrr_report). SECURITY DEFINER com guard super_admin OU operador interno ativo '
  '(is_active_internal_operator). Nenhum segredo.';

revoke all on function public.membership_mrr_churn(date, date) from public, anon;
grant execute on function public.membership_mrr_churn(date, date) to authenticated, service_role;

-- ============================================================================
-- 4) nfce_volume — NFCe por status no período (fiscal_documents, ADR-02).
-- ============================================================================
create or replace function public.nfce_volume(
  p_from date,
  p_to   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_autorizadas   int;
  v_contingencia  int;
  v_rejeitadas    int;
  v_canceladas    int;
  v_pendentes     int;
  v_valor         bigint;
begin
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'INVALID_RANGE' using errcode = 'PT400';
  end if;

  select count(*) filter (where f.status = 'autorizada')::int,
         count(*) filter (where f.status = 'contingencia')::int,
         count(*) filter (where f.status = 'rejeitada')::int,
         count(*) filter (where f.status = 'cancelada')::int,
         count(*) filter (where f.status = 'pendente')::int,
         coalesce(sum(f.valor_cents) filter (where f.status = 'autorizada'), 0)::bigint
    into v_autorizadas, v_contingencia, v_rejeitadas, v_canceladas, v_pendentes, v_valor
    from public.fiscal_documents f
   where f.created_at >= p_from::timestamptz
     and f.created_at < (p_to + 1)::timestamptz;

  return jsonb_build_object(
    'kind', 'nfce',
    'from', p_from,
    'to', p_to,
    'autorizadas', v_autorizadas,
    'contingencia', v_contingencia,
    'rejeitadas', v_rejeitadas,
    'canceladas', v_canceladas,
    'pendentes', v_pendentes,
    'valor_autorizado_cents', v_valor
  );
end;
$$;

comment on function public.nfce_volume(date, date) is
  'Back-office T1.5 (ADR-11): volume NFCe por status no periodo (fiscal_documents). '
  'SECURITY DEFINER com guard super_admin OU operador interno ativo (is_active_internal_operator). '
  'Nenhum segredo.';

revoke all on function public.nfce_volume(date, date) from public, anon;
grant execute on function public.nfce_volume(date, date) to authenticated, service_role;
