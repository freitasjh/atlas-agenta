-- Migration: RPCs do dashboard do super admin (ADR-15) — backend (SECURITY DEFINER)
-- O hook atual lia `whatsapp_instances` e `appointments` diretamente, mas super_admin
-- não tem RLS cross-tenant nessas tabelas (whatsapp_instances nem policy para super_admin).
-- Estas RPCs rodam SECURITY DEFINER e verificam `current_role_name() = 'super_admin'`,
-- devolvendo dados agregados/linhas apenas para o super_admin. Qualquer outro papel recebe
-- null / conjunto vazio. Idempotente (create or replace).

-- ============================================================================
-- admin_dashboard_counts — KPIs agregados do painel (jsonb). Retorna null se não super_admin.
-- ============================================================================
create or replace function public.admin_dashboard_counts()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when current_role_name() is distinct from 'super_admin' then null::jsonb
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

comment on function public.admin_dashboard_counts() is
  'Dashboard super admin (ADR-15): KPIs agregados (tenants por status, trials vencendo em 7d, '
  'bloqueados, WhatsApp desconectado, agendamentos no mes). SECURITY DEFINER: so super_admin '
  'recebe dados; demais papeis recebem null.';

revoke all on function public.admin_dashboard_counts() from anon;
revoke all on function public.admin_dashboard_counts() from public;
grant execute on function public.admin_dashboard_counts() to authenticated;

-- ============================================================================
-- admin_dashboard_disconnected_whatsapp — instancias nao conectadas (so super_admin).
-- ============================================================================
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
    and current_role_name() = 'super_admin';
$$;

comment on function public.admin_dashboard_disconnected_whatsapp() is
  'Dashboard super admin (ADR-15): instancias WhatsApp nao conectadas com nome do tenant. '
  'SECURITY DEFINER: so super_admin recebe linhas; demais papeis recebem conjunto vazio.';

revoke all on function public.admin_dashboard_disconnected_whatsapp() from anon;
revoke all on function public.admin_dashboard_disconnected_whatsapp() from public;
grant execute on function public.admin_dashboard_disconnected_whatsapp() to authenticated;
