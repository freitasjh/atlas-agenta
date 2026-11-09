-- Migration: internal-admin-migracao-telas (MIG-BE-01/BE-03/BE-04).
-- Aditiva + idempotente (create or replace, alter ... add column if not exists).
--
-- BE-01: helper `is_active_internal_operator()` SECURITY DEFINER — true só para
-- operador interno ativo (`auth.uid()` em `internal_operators` sem `disabled_at`).
-- `search_path` fixo; REVOKE anon/public; GRANT authenticated (as RPCs 02b chamam
-- dentro do corpo DEFINER; o GRANT permite ainda checagem direta quando preciso).
-- RLS de tenant INTOCADA (nenhuma policy alterada/criada aqui).
--
-- BE-03: as 11 RPCs de leitura do backoffice ganham `OR is_active_internal_operator()`
-- no guard interno (lista fechada 02b). Sem `super_admin` ao operador; sem tocar RLS.
--   reads null/empty: admin_dashboard_counts, admin_dashboard_disconnected_whatsapp,
--     admin_usage_overview, admin_usage_series, admin_usage_tenants,
--     admin_get_plan_mrr, admin_get_trial_conversion, admin_get_quota_utilization,
--     admin_get_churn_por_plano, admin_get_plan_divergences, admin_get_tenant_plan.
-- Writes (admin_set_subscription_status, admin_set_tenant_plan) seguem Edge-gated
-- (service_role only, sem EXECUTE p/ authenticated): INALTERADAS.
--
-- BE-04: auditoria append-only + métrica de negas.
--   - `internal_operator_audit.voided_at`: correção é estorno lógico (update SÓ pode
--     preencher `voided_at`; demais colunas imutáveis; DELETE sempre negado 42501).
--   - `internal_admin_denies_total`: contador de negas de BOLA/AAL2 (1 linha id=1),
--     `internal_admin_deny()` incrementa (service_role via Edges, best-effort).
-- Nenhum segredo. Sem PII.

-- ============================================================================
-- BE-01. Helper de operador ativo.
-- ============================================================================
create or replace function public.is_active_internal_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.internal_operators
    where user_id = auth.uid() and disabled_at is null
  );
$$;

comment on function public.is_active_internal_operator() is
  'MIG-BE-01: true só para operador interno ativo (auth.uid em internal_operators sem disabled_at). '
  'Usado no OR dos guards das RPCs 02b; nunca como prova isolada no cliente (AAL2 é server-side na Edge).';

revoke all on function public.is_active_internal_operator() from anon;
revoke all on function public.is_active_internal_operator() from public;
grant execute on function public.is_active_internal_operator() to authenticated;

-- ============================================================================
-- BE-03. RPCs 02b: guard = super_admin OR operador ativo.
-- ============================================================================

-- admin_dashboard_counts — null se (não super_admin E não operador).
create or replace function public.admin_dashboard_counts()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when (current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator()) then null::jsonb
    else jsonb_build_object(
      'tenants_by_status',
        coalesce(
          (select jsonb_object_agg(subscription_status, cnt)
           from (select subscription_status, count(*)::int as cnt
                 from public.tenants group by subscription_status) s),
          '{}'::jsonb
        ),
      'trials_expiring_7d',
        (select count(*)::int from public.tenants
         where subscription_status = 'trial'
           and trial_ends_at is not null
           and trial_ends_at >= now()
           and trial_ends_at <= now() + interval '7 days'),
      'blocked',
        (select count(*)::int from public.tenants where subscription_status = 'bloqueado'),
      'disconnected_whatsapp',
        (select count(*)::int from public.whatsapp_instances where connection_status <> 'conectado'),
      'appointments_this_month',
        (select count(*)::int from public.appointments
         where created_at >= date_trunc('month', now()))
    )
  end;
$$;

revoke all on function public.admin_dashboard_counts() from anon;
revoke all on function public.admin_dashboard_counts() from public;
grant execute on function public.admin_dashboard_counts() to authenticated;

-- admin_dashboard_disconnected_whatsapp — vazio se (não super_admin E não operador).
create or replace function public.admin_dashboard_disconnected_whatsapp()
returns table (
  tenant_id         uuid,
  trade_name        text,
  connection_status text,
  last_connected_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select wi.tenant_id,
         t.trade_name,
         wi.connection_status,
         wi.last_connected_at
  from public.whatsapp_instances wi
  join public.tenants t on t.id = wi.tenant_id
  where wi.connection_status <> 'conectado'
    and (current_role_name() = 'super_admin' or public.is_active_internal_operator());
$$;

revoke all on function public.admin_dashboard_disconnected_whatsapp() from anon;
revoke all on function public.admin_dashboard_disconnected_whatsapp() from public;
grant execute on function public.admin_dashboard_disconnected_whatsapp() to authenticated;

-- admin_usage_overview — null se (não super_admin E não operador).
create or replace function public.admin_usage_overview(p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when (current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator()) then null::jsonb
    else jsonb_build_object(
      'total_appointments',
        (select count(*)::int from public.appointments
         where starts_at >= p_start and starts_at <= p_end),
      'no_show_rate',
        coalesce(
          (select (count(*) filter (where status = 'nao_compareceu'))::numeric * 100.0
                  / nullif(count(*), 0)
           from public.appointments
           where starts_at >= p_start and starts_at <= p_end),
          0
        ),
      'confirmation_rate',
        coalesce(
          (select (count(*) filter (where status = 'confirmado'))::numeric * 100.0
                  / nullif(count(*), 0)
           from public.appointments
           where starts_at >= p_start and starts_at <= p_end),
          0
        ),
      'whatsapp_usage',
        (select count(*)::int from public.messages
         where created_at >= p_start and created_at <= p_end),
      'new_tenants',
        (select count(*)::int from public.tenants
         where created_at >= p_start and created_at <= p_end),
      'retention',
        jsonb_build_object(
          'active',
            (select count(*)::int from public.tenants
             where subscription_status in ('ativo','trial')),
          'cancelled',
            (select count(*)::int from public.tenants
             where subscription_status = 'cancelado'),
          'rate',
            coalesce(
              (select (count(*) filter (where subscription_status in ('ativo','trial')))::numeric * 100.0
                      / nullif(count(*) filter (where subscription_status in ('ativo','trial','cancelado')), 0)
               from public.tenants),
              0
            )
        )
    )
  end;
$$;

revoke all on function public.admin_usage_overview(timestamptz, timestamptz) from anon;
revoke all on function public.admin_usage_overview(timestamptz, timestamptz) from public;
grant execute on function public.admin_usage_overview(timestamptz, timestamptz) to authenticated;

-- admin_usage_series — vazio se (não super_admin E não operador).
create or replace function public.admin_usage_series(
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text
)
returns table (
  bucket timestamptz,
  appointments int,
  no_show int,
  confirmed int
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select date_trunc(
           case when p_bucket in ('day','week','month') then p_bucket else 'day' end,
           a.starts_at
         ) as bucket,
         count(*)::int as appointments,
         count(*) filter (where a.status = 'nao_compareceu')::int as no_show,
         count(*) filter (where a.status = 'confirmado')::int as confirmed
  from public.appointments a
  where a.starts_at >= p_start
    and a.starts_at <= p_end
    and (current_role_name() = 'super_admin' or public.is_active_internal_operator())
  group by 1
  order by 1;
$$;

revoke all on function public.admin_usage_series(timestamptz, timestamptz, text) from anon;
revoke all on function public.admin_usage_series(timestamptz, timestamptz, text) from public;
grant execute on function public.admin_usage_series(timestamptz, timestamptz, text) to authenticated;

-- admin_usage_tenants — vazio se (não super_admin E não operador).
create or replace function public.admin_usage_tenants(p_start timestamptz, p_end timestamptz)
returns table (
  tenant_id uuid,
  trade_name text,
  appointments int,
  no_show int,
  whatsapp int
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select t.id as tenant_id,
         t.trade_name,
         coalesce(a.cnt, 0)::int as appointments,
         coalesce(a.no_show, 0)::int as no_show,
         coalesce(m.cnt, 0)::int as whatsapp
  from public.tenants t
  left join lateral (
    select count(*)::int as cnt,
           count(*) filter (where status = 'nao_compareceu')::int as no_show
    from public.appointments
    where tenant_id = t.id
      and starts_at >= p_start and starts_at <= p_end
  ) a on true
  left join lateral (
    select count(*)::int as cnt
    from public.messages
    where tenant_id = t.id
      and created_at >= p_start and created_at <= p_end
  ) m on true
  where (current_role_name() = 'super_admin' or public.is_active_internal_operator())
  order by appointments desc, t.trade_name;
$$;

revoke all on function public.admin_usage_tenants(timestamptz, timestamptz) from anon;
revoke all on function public.admin_usage_tenants(timestamptz, timestamptz) from public;
grant execute on function public.admin_usage_tenants(timestamptz, timestamptz) to authenticated;

-- admin_get_plan_mrr — null se (não super_admin E não operador).
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
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
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

revoke all on function public.admin_get_plan_mrr(text) from anon;
revoke all on function public.admin_get_plan_mrr(text) from public;
grant execute on function public.admin_get_plan_mrr(text) to authenticated;

-- admin_get_trial_conversion — null se (não super_admin E não operador).
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
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
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

revoke all on function public.admin_get_trial_conversion(date, date, text) from anon;
revoke all on function public.admin_get_trial_conversion(date, date, text) from public;
grant execute on function public.admin_get_trial_conversion(date, date, text) to authenticated;

-- admin_get_quota_utilization — forbidden se (não super_admin E não operador).
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
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
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

revoke all on function public.admin_get_quota_utilization(numeric) from anon;
revoke all on function public.admin_get_quota_utilization(numeric) from public;
grant execute on function public.admin_get_quota_utilization(numeric) to authenticated;

-- admin_get_churn_por_plano — null se (não super_admin E não operador).
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
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
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

revoke all on function public.admin_get_churn_por_plano(text) from anon;
revoke all on function public.admin_get_churn_por_plano(text) from public;
grant execute on function public.admin_get_churn_por_plano(text) to authenticated;

-- admin_get_plan_divergences — forbidden se (não super_admin E não operador).
create or replace function public.admin_get_plan_divergences()
returns table (
  charge_id uuid,
  tenant_id uuid,
  charge_plan text,
  current_plan text,
  amount_cents integer,
  paid_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  return query
    select
      v.charge_id,
      v.tenant_id,
      v.charge_plan,
      v.current_plan,
      v.amount_cents,
      v.paid_at
    from public.v_charges_pagas_sem_plano v
    order by v.paid_at desc nulls last;
end;
$$;

revoke all on function public.admin_get_plan_divergences() from public;
revoke all on function public.admin_get_plan_divergences() from anon;
grant execute on function public.admin_get_plan_divergences() to authenticated;

-- admin_get_tenant_plan — forbidden se (não super_admin E não operador).
create or replace function public.admin_get_tenant_plan(p_tenant_id uuid)
returns table (plan text, active_professionals int, month_appointments int, month_key text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.tenant_plan_usage(p_tenant_id);
end;
$$;

revoke all on function public.admin_get_tenant_plan(uuid) from public;
revoke all on function public.admin_get_tenant_plan(uuid) from anon;
grant execute on function public.admin_get_tenant_plan(uuid) to authenticated;

-- ============================================================================
-- BE-04. Auditoria append-only (voided_at = estorno lógico) + métrica de negas.
-- ============================================================================

alter table public.internal_operator_audit
  add column if not exists voided_at timestamptz;

create or replace function public.internal_operator_audit_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'internal_operator_audit is append-only' using errcode = '42501';
  end if;
  -- UPDATE: único caminho é preencher voided_at (estorno lógico da correção);
  -- demais colunas imutáveis, e voided_at nunca pode ser limpo.
  if OLD.voided_at is not distinct from NEW.voided_at then
    raise exception 'internal_operator_audit is append-only' using errcode = '42501';
  end if;
  if OLD.id is distinct from NEW.id
     or OLD.operator_user_id is distinct from NEW.operator_user_id
     or OLD.action is distinct from NEW.action
     or OLD.actor_user_id is distinct from NEW.actor_user_id
     or OLD.created_at is distinct from NEW.created_at then
    raise exception 'internal_operator_audit is append-only' using errcode = '42501';
  end if;
  if OLD.voided_at is not null or NEW.voided_at is null then
    raise exception 'internal_operator_audit is append-only' using errcode = '42501';
  end if;
  return NEW;
end;
$$;

revoke all on function public.internal_operator_audit_append_only() from anon, authenticated;
revoke all on function public.internal_operator_audit_append_only() from public;

drop trigger if exists internal_operator_audit_append_only_trg on public.internal_operator_audit;

create trigger internal_operator_audit_append_only_trg
  before update or delete on public.internal_operator_audit
  for each row execute function public.internal_operator_audit_append_only();

-- Métrica de negas BOLA/AAL2 (SPEC G10): 1 linha (id=1), incrementada best-effort
-- pelas Edges 02a via `internal_admin_deny()` (service_role). Sem PII.
create table if not exists public.internal_admin_denies_total (
  id bigint primary key,
  denies bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.internal_admin_denies_total enable row level security;

revoke all on public.internal_admin_denies_total from anon, authenticated;

insert into public.internal_admin_denies_total (id, denies)
  values (1, 0)
  on conflict (id) do nothing;

create or replace function public.internal_admin_deny()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.internal_admin_denies_total
    set denies = denies + 1, updated_at = now()
    where id = 1;
end;
$$;

revoke all on function public.internal_admin_deny() from anon, authenticated;
revoke all on function public.internal_admin_deny() from public;
