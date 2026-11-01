-- Migration: RPCs de métricas de uso do super admin (ADR-18) — somente leitura, cross-tenant.
-- Agrega appointments, messages, tenants por período. SECURITY DEFINER com guarda
-- `current_role_name() = 'super_admin'`; revoke anon/public; grant authenticated.
-- Idempotente (create or replace).

-- ============================================================================
-- admin_usage_overview(p_start, p_end): jsonb com KPIs agregados. null se não super_admin.
-- ============================================================================
create or replace function public.admin_usage_overview(p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when current_role_name() is distinct from 'super_admin' then null::jsonb
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

comment on function public.admin_usage_overview(timestamptz, timestamptz) is
  'ADR-18: KPIs de uso do super admin (agendamentos, no-show %, confirmação %, WhatsApp, '
  'novas empresas, retenção). SECURITY DEFINER: so super_admin recebe dados.';

revoke all on function public.admin_usage_overview(timestamptz, timestamptz) from anon;
revoke all on function public.admin_usage_overview(timestamptz, timestamptz) from public;
grant execute on function public.admin_usage_overview(timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- admin_usage_series(p_start, p_end, p_bucket): série temporal.
-- ============================================================================
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
    and current_role_name() = 'super_admin'
  group by 1
  order by 1;
$$;

comment on function public.admin_usage_series(timestamptz, timestamptz, text) is
  'ADR-18: série temporal de uso (bucket, appointments, no_show, confirmed). SECURITY DEFINER.';

revoke all on function public.admin_usage_series(timestamptz, timestamptz, text) from anon;
revoke all on function public.admin_usage_series(timestamptz, timestamptz, text) from public;
grant execute on function public.admin_usage_series(timestamptz, timestamptz, text) to authenticated;

-- ============================================================================
-- admin_usage_tenants(p_start, p_end): detalhe por tenant.
-- ============================================================================
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
  where current_role_name() = 'super_admin'
  order by appointments desc, t.trade_name;
$$;

comment on function public.admin_usage_tenants(timestamptz, timestamptz) is
  'ADR-18: detalhe de uso por tenant. SECURITY DEFINER: so super_admin recebe linhas.';

revoke all on function public.admin_usage_tenants(timestamptz, timestamptz) from anon;
revoke all on function public.admin_usage_tenants(timestamptz, timestamptz) from public;
grant execute on function public.admin_usage_tenants(timestamptz, timestamptz) to authenticated;
