-- Migration: telemetria de planos do super admin (plan-telemetry-pacote) — somente leitura.
--
-- 4 views `security_invoker=true` SEM grant (só catálogo/EXPLAIN; leitura real é
-- pelos RPCs) + 4 RPCs STABLE SECURITY DEFINER com guard `current_role_name() =
-- 'super_admin'` (jsonb RPCs devolvem null, quota RPC levanta insufficient_privilege).
-- Sem tabela nova, sem scheduler, sem escrita. Idempotente.
--
-- Semântica congelada (SPEC G1):
--   MRR = SUM(CASE plan) só `subscription_status='ativo'`. Demais status = 0.
--   Conversão trial = coorte `tenants.created_at` × trial→ativo via
--     `subscription_status_changes` em 14d (fallback `trial_ends_at`); denominador
--     exclui trials vigentes (<14d). Fontes audit obrigatórias: `tenants` +
--     `subscription_status_changes` + `tenant_plan_changes`; snapshot
--     `tenants.status` sozinho proibido.
--   Quota quente = mesma lógica de `tenant_plan_usage()` (profs ativos vs limite;
--     appts do mês no fuso do tenant, `status!='cancelado'`, inclui public_booking).
--     `near_limit >=80%`, `over_limit >=100%`. Ordenado % desc, LIMIT 100.
--   Churn = transições →cancelado no mês via `subscription_status_changes`;
--     denominador = base início do mês; plano no evento via `tenant_plan_changes`
--     (nunca `tenants.plan` corrente). Reativação não apaga churn.
--
-- PREÇO — fonte única: `supabase/functions/_shared/plans.json` (individual 5900,
-- clinica 14900, pro 25900). O CASE abaixo é ESPELHO travado por teste de paridade
-- (`supabase/tests/44-plan-telemetry.test.sql` + `src/lib/plan-telemetry-parity.test.ts`
-- + `scripts/check-plan-telemetry-parity.mjs` no CI); divergência plans.json ×
-- migration = falha. Nunca editar um lado sem o outro.

-- ============================================================================
-- 0. Helper de preço (espelho plans.json; ver comentário PREÇO acima).
-- ============================================================================
create or replace function public.plan_price_cents(p_plan text)
returns int
language sql
immutable
as $$
  select case p_plan
    when 'individual' then 5900
    when 'clinica' then 14900
    when 'pro' then 25900
    else 0
  end;
$$;

comment on function public.plan_price_cents(text) is
  'Espelho de supabase/functions/_shared/plans.json (individual 5900, clinica 14900, pro 25900). '
  'Paridade travada por teste; divergencia = falha. Usado por v_plan_mrr e admin_get_plan_mrr.';

revoke all on function public.plan_price_cents(text) from anon;
revoke all on function public.plan_price_cents(text) from public;
grant execute on function public.plan_price_cents(text) to authenticated;

-- Validador YYYY-MM (server-side; mês injetado nunca vai cru para date_trunc).
create or replace function public.plan_telemetry_valid_month(p_month text)
returns boolean
language sql
immutable
as $$
  select p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$';
$$;

revoke all on function public.plan_telemetry_valid_month(text) from anon;
revoke all on function public.plan_telemetry_valid_month(text) from public;
grant execute on function public.plan_telemetry_valid_month(text) to authenticated;

-- ============================================================================
-- 1. v_plan_mrr — MRR por plano (só ativos × preço; demais status = 0).
-- ============================================================================
create or replace view public.v_plan_mrr as
select
  t.plan as plan,
  count(*)::int as base_ativa,
  (count(*)::bigint * public.plan_price_cents(t.plan))::bigint as mrr_cents
from public.tenants t
where t.subscription_status = 'ativo'
group by t.plan;

alter view public.v_plan_mrr set (security_invoker = true);
revoke all on table public.v_plan_mrr from public;
revoke all on table public.v_plan_mrr from anon, authenticated;

comment on view public.v_plan_mrr is
  'Telemetria super_admin (somente leitura): base ativa e MRR por plano. security_invoker; '
  'sem grant — leitura real via admin_get_plan_mrr.';

-- ============================================================================
-- 2. v_trial_conversion_por_plano — coorte × conversão 14d (via audit).
-- ============================================================================
create or replace view public.v_trial_conversion_por_plano as
with coorte as (
  select id, plan, created_at, trial_ends_at
  from public.tenants
  where created_at <= now() - interval '14 days'
),
convertidos as (
  select distinct s.tenant_id
  from public.subscription_status_changes s
  join coorte c on c.id = s.tenant_id
  where s.old_status = 'trial'
    and s.new_status = 'ativo'
    and s.created_at <= c.created_at + interval '14 days'
)
select
  c.plan as plan,
  count(*)::int as coorte,
  count(cv.tenant_id)::int as convertidos,
  case when count(*) = 0 then null
       else (count(cv.tenant_id)::numeric * 100.0 / count(*))
  end as taxa
from coorte c
left join convertidos cv on cv.tenant_id = c.id
group by c.plan;

alter view public.v_trial_conversion_por_plano set (security_invoker = true);
revoke all on table public.v_trial_conversion_por_plano from public;
revoke all on table public.v_trial_conversion_por_plano from anon, authenticated;

comment on view public.v_trial_conversion_por_plano is
  'Telemetria super_admin: coorte de tenants (created_at, -14d vigentes) × conversão '
  'trial→ativo em 14d via subscription_status_changes. security_invoker; sem grant — '
  'leitura real via admin_get_trial_conversion.';

-- ============================================================================
-- 3. v_quota_utilization — uso por tenant (lógica = tenant_plan_usage).
-- ============================================================================
create or replace view public.v_quota_utilization as
with profs as (
  select tenant_id, count(*)::int as profs
  from public.professionals
  where active = true
  group by tenant_id
),
appts as (
  select
    a.tenant_id,
    count(*)::int as appts
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  where a.status != 'cancelado'
    and to_char(
      (a.starts_at at time zone coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')),
      'YYYY-MM'
    ) = to_char(
      (now() at time zone coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')),
      'YYYY-MM'
    )
  group by a.tenant_id
)
select
  t.id as tenant_id,
  t.trade_name as trade_name,
  t.plan as plan,
  coalesce(p.profs, 0) as profs,
  public.plan_professional_limit(t.plan) as prof_limit,
  coalesce(a.appts, 0) as appts,
  public.plan_appointment_limit(t.plan) as appt_limit,
  to_char(
    (now() at time zone coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')),
    'YYYY-MM'
  ) as month_key
from public.tenants t
left join profs p on p.tenant_id = t.id
left join appts a on a.tenant_id = t.id;

alter view public.v_quota_utilization set (security_invoker = true);
revoke all on table public.v_quota_utilization from public;
revoke all on table public.v_quota_utilization from anon, authenticated;

comment on view public.v_quota_utilization is
  'Telemetria super_admin: uso por tenant (profs ativos + appts do mês no fuso, '
  'exclui cancelado, inclui public_booking). security_invoker; sem grant — leitura '
  'real via admin_get_quota_utilization (LIMIT 100).';

-- ============================================================================
-- 4. v_churn_por_plano — base × cancelados no mês corrente (via audit).
-- ============================================================================
create or replace view public.v_churn_por_plano as
with month_bounds as (
  select
    date_trunc('month', now()) as m_start,
    to_char(date_trunc('month', now()), 'YYYY-MM') as month_key
),
churned as (
  select distinct s.tenant_id
  from public.subscription_status_changes s, month_bounds b
  where s.new_status = 'cancelado'
    and s.created_at >= b.m_start
    and s.created_at < b.m_start + interval '1 month'
),
base as (
  select id, plan
  from public.tenants, month_bounds b
  where created_at < b.m_start
)
select
  coalesce(ch.plan, ba.plan) as plan,
  count(distinct ba.id)::int as base,
  count(distinct ch.tenant_id)::int as churned,
  case when count(distinct ba.id) = 0 then null
       else (count(distinct ch.tenant_id)::numeric * 100.0 / count(distinct ba.id))
  end as taxa,
  (select month_key from month_bounds) as month_key
from base ba
full outer join (
  select ch.tenant_id,
         coalesce(
           (select new_plan from public.tenant_plan_changes pc
             where pc.tenant_id = ch.tenant_id and pc.created_at < (select m_start + interval '1 month' from month_bounds)
             order by pc.created_at desc limit 1),
           (select plan from public.tenants t where t.id = ch.tenant_id)
         ) as plan
  from churned ch
) ch on ch.plan = ba.plan
group by coalesce(ch.plan, ba.plan);

alter view public.v_churn_por_plano set (security_invoker = true);
revoke all on table public.v_churn_por_plano from public;
revoke all on table public.v_churn_por_plano from anon, authenticated;

comment on view public.v_churn_por_plano is
  'Telemetria super_admin: base início do mês × cancelados no mês via '
  'subscription_status_changes; plano no evento via tenant_plan_changes. '
  'security_invoker; sem grant — leitura real via admin_get_churn_por_plano.';

-- ============================================================================
-- 5. RPCs (único caminho de leitura do cliente; STABLE DEFINER, guard interno).
-- ============================================================================

-- admin_get_plan_mrr(p_month 'YYYY-MM') → {mrr_cents, by_plan, base_ativa}. null se não super_admin.
create or replace function public.admin_get_plan_mrr(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_mrr bigint;
  v_base int;
  v_by_plan jsonb;
begin
  if current_role_name() is distinct from 'super_admin' then
    return null;
  end if;
  if p_month is null or not public.plan_telemetry_valid_month(p_month) then
    raise exception 'invalid_month' using errcode = 'check_violation';
  end if;
  select coalesce(sum(public.plan_price_cents(t.plan))::bigint, 0),
         count(*)::int
    into v_mrr, v_base
  from public.tenants t
  where t.subscription_status = 'ativo';
  select coalesce(jsonb_object_agg(plan, jsonb_build_object('base', base_ativa, 'mrr_cents', mrr_cents)), '{}'::jsonb)
    into v_by_plan
  from public.v_plan_mrr;
  return jsonb_build_object('mrr_cents', v_mrr, 'by_plan', v_by_plan, 'base_ativa', v_base);
end;
$$;

comment on function public.admin_get_plan_mrr(text) is
  'Telemetria super_admin (SPEC G1): MRR = SUM(ativos × preço). Preço espelho '
  'supabase/functions/_shared/plans.json (paridade travada). Null se não super_admin.';

revoke all on function public.admin_get_plan_mrr(text) from anon;
revoke all on function public.admin_get_plan_mrr(text) from public;
grant execute on function public.admin_get_plan_mrr(text) to authenticated;

-- admin_get_trial_conversion(p_start, p_end, p_plan?) → {coorte, convertidos, taxa}. null se não super_admin.
create or replace function public.admin_get_trial_conversion(p_start date, p_end date, p_plan text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_coorte int;
  v_conv int;
begin
  if current_role_name() is distinct from 'super_admin' then
    return null;
  end if;
  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'invalid_range' using errcode = 'check_violation';
  end if;
  if p_plan is not null and p_plan not in ('individual', 'clinica', 'pro') then
    raise exception 'invalid_plan' using errcode = 'check_violation';
  end if;
  with coorte as (
    select id, created_at
    from public.tenants
    where created_at::date >= p_start
      and created_at::date <= p_end
      and created_at <= now() - interval '14 days'
      and (p_plan is null or plan = p_plan)
  ),
  convertidos as (
    select distinct s.tenant_id
    from public.subscription_status_changes s
    join coorte c on c.id = s.tenant_id
    where s.old_status = 'trial'
      and s.new_status = 'ativo'
      and s.created_at <= c.created_at + interval '14 days'
  )
  select (select count(*)::int from coorte),
         (select count(*)::int from convertidos)
    into v_coorte, v_conv;
  return jsonb_build_object(
    'coorte', v_coorte,
    'convertidos', v_conv,
    'taxa', case when v_coorte = 0 then null
                 else (v_conv::numeric * 100.0 / v_coorte) end
  );
end;
$$;

comment on function public.admin_get_trial_conversion(date, date, text) is
  'Telemetria super_admin: coorte created_at × conversão trial→ativo 14d via '
  'subscription_status_changes (denominador exclui vigentes). Null se não super_admin.';

revoke all on function public.admin_get_trial_conversion(date, date, text) from anon;
revoke all on function public.admin_get_trial_conversion(date, date, text) from public;
grant execute on function public.admin_get_trial_conversion(date, date, text) to authenticated;

-- admin_get_quota_utilization(p_threshold 0.8) → tabela quente; LIMIT 100.
-- Levanta insufficient_privilege se não super_admin (G4: negar alto, não vazio silencioso).
create or replace function public.admin_get_quota_utilization(p_threshold numeric default 0.8)
returns table (
  tenant_id uuid,
  trade_name text,
  plan text,
  profs int,
  prof_limit int,
  appts int,
  appt_limit int,
  month_key text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_thr numeric;
begin
  if current_role_name() is distinct from 'super_admin' then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  v_thr := coalesce(p_threshold, 0.8);
  if v_thr < 0 or v_thr > 1 then
    raise exception 'invalid_threshold' using errcode = 'check_violation';
  end if;
  return query
  with profs as (
    select p.tenant_id as tenant_id, count(*)::int as profs
    from public.professionals p
    where p.active = true
    group by p.tenant_id
  ),
  appts as (
    select
      a.tenant_id as tenant_id,
      count(*)::int as appts
    from public.appointments a
    join public.tenants t on t.id = a.tenant_id
    where a.status != 'cancelado'
      and to_char(
        (a.starts_at at time zone coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')),
        'YYYY-MM'
      ) = to_char(
        (now() at time zone coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')),
        'YYYY-MM'
      )
    group by a.tenant_id
  ),
  uso as (
    select
      t.id as tenant_id,
      t.trade_name as trade_name,
      t.plan as plan,
      coalesce(p.profs, 0) as profs,
      public.plan_professional_limit(t.plan) as prof_limit,
      coalesce(a.appts, 0) as appts,
      public.plan_appointment_limit(t.plan) as appt_limit,
      to_char(
        (now() at time zone coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')),
        'YYYY-MM'
      ) as month_key
    from public.tenants t
    left join profs p on p.tenant_id = t.id
    left join appts a on a.tenant_id = t.id
  )
  select
    u.tenant_id, u.trade_name, u.plan, u.profs, u.prof_limit, u.appts, u.appt_limit, u.month_key
  from uso u
  where (u.prof_limit is not null and u.prof_limit > 0 and u.profs::numeric / u.prof_limit >= v_thr)
     or (u.appt_limit is not null and u.appt_limit > 0 and u.appts::numeric / u.appt_limit >= v_thr)
  order by greatest(
    case when u.prof_limit is not null and u.prof_limit > 0 then u.profs::numeric / u.prof_limit else 0 end,
    case when u.appt_limit is not null and u.appt_limit > 0 then u.appts::numeric / u.appt_limit else 0 end
  ) desc
  limit 100;
end;
$$;

comment on function public.admin_get_quota_utilization(numeric) is
  'Telemetria super_admin: tenants quentes (>=threshold, default 0.8) em profs ou '
  'appts do mês (fuso do tenant). Ordenado % desc, LIMIT 100. Levanta forbidden '
  'se não super_admin.';

revoke all on function public.admin_get_quota_utilization(numeric) from anon;
revoke all on function public.admin_get_quota_utilization(numeric) from public;
grant execute on function public.admin_get_quota_utilization(numeric) to authenticated;

-- admin_get_churn_por_plano(p_month 'YYYY-MM') → {by_plan:{base,churned,taxa}}. null se não super_admin.
create or replace function public.admin_get_churn_por_plano(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_by_plan jsonb;
begin
  if current_role_name() is distinct from 'super_admin' then
    return null;
  end if;
  if p_month is null or not public.plan_telemetry_valid_month(p_month) then
    raise exception 'invalid_month' using errcode = 'check_violation';
  end if;
  v_start := (p_month || '-01')::date::timestamptz;
  v_end := v_start + interval '1 month';
  with churned as (
    select distinct s.tenant_id
    from public.subscription_status_changes s
    where s.new_status = 'cancelado'
      and s.created_at >= v_start
      and s.created_at < v_end
  ),
  base as (
    select id, plan
    from public.tenants
    where created_at < v_start
  ),
  churned_plan as (
    select ch.tenant_id,
           coalesce(
             (select pc.new_plan from public.tenant_plan_changes pc
               where pc.tenant_id = ch.tenant_id and pc.created_at < v_end
               order by pc.created_at desc limit 1),
             (select t.plan from public.tenants t where t.id = ch.tenant_id)
           ) as plan
    from churned ch
  ),
  plans as (
    select distinct plan from (
      select plan from base
      union
      select plan from churned_plan
    ) u where plan is not null
  ),
  agg as (
    select
      p.plan as plan,
      (select count(*)::int from base b where b.plan = p.plan) as base,
      (select count(*)::int from churned_plan c where c.plan = p.plan) as churned
    from plans p
  )
  select coalesce(jsonb_object_agg(
    plan,
    jsonb_build_object(
      'base', base,
      'churned', churned,
      'taxa', case when base = 0 then null else (churned::numeric * 100.0 / base) end
    )
  ), '{}'::jsonb)
  into v_by_plan
  from agg;
  return jsonb_build_object('by_plan', v_by_plan);
end;
$$;

comment on function public.admin_get_churn_por_plano(text) is
  'Telemetria super_admin: base início do mês × cancelados no mês via '
  'subscription_status_changes; plano no evento via tenant_plan_changes. '
  'Null se não super_admin.';

revoke all on function public.admin_get_churn_por_plano(text) from anon;
revoke all on function public.admin_get_churn_por_plano(text) from public;
grant execute on function public.admin_get_churn_por_plano(text) to authenticated;
