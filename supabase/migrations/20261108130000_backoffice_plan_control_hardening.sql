-- Hardening do backoffice plan control (code-review loop 1/3).
-- Corrige 3 🔴 sem mudar comportamento Fase 1 (upgrade/downgrade imediato,
-- grandfather, webhook nunca toca plan):
--
--  C1. view v_charges_pagas_sem_plano: security_invoker=true + REVOKE
--      anon/authenticated + RPC admin_get_plan_divergences() (guard
--      super_admin interno) como único caminho de leitura.
--  C2. tenant_plan_usage(): REVOKE authenticated (só service_role executa
--      direto); backoffice usa admin_get_tenant_plan como único caminho.
--  C3. Triggers passam a cobrir UPDATE (reativação de profissional,
--      saída de cancelado / mudança de mês), reusando a mesma lógica
--      PLAN_LIMIT, com correção de autocontagem no UPDATE.
--
-- TOCTOU conhecido (documentado, não travado nesta migration): a checagem
-- conta-linhas-then-insert é vulnerável a corrida entre transações
-- concorrentes (duas sessões contam abaixo do teto e inserem juntas).
-- Mitigação prescrita Fase 3: pg_advisory_xact_lock(hashtext(tenant
-- || bucket)) no topo de enforce_*_plan_limit() e do ramo de downgrade de
-- admin_set_tenant_plan, ou serializar via SELECT ... FOR UPDATE na linha
-- do tenant antes de contar. Ver RUNBOOK (seção TOCTOU).
--
-- Idempotente (alter/create or replace, drop if exists, revoke antes de
-- grant). Nenhum segredo.

-- ============================================================================
-- C1. View de reconciliação: invoker rights + sem acesso direto do cliente.
-- ============================================================================
alter view public.v_charges_pagas_sem_plano set (security_invoker = true);

revoke all on table public.v_charges_pagas_sem_plano from public;
revoke all on table public.v_charges_pagas_sem_plano from anon, authenticated;

-- Único caminho de leitura: RPC com guard super_admin interno (o security
-- definer avalia as tabelas base com o owner; o guard decide quem vê).
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
  if current_role_name() is distinct from 'super_admin' then
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

comment on function public.admin_get_plan_divergences() is
  'Unico caminho de leitura das divergencias charge paga x plano do tenant (super_admin, guard interno). '
  'A view v_charges_pagas_sem_plano e security_invoker e revogada para anon/authenticated.';

revoke all on function public.admin_get_plan_divergences() from public;
revoke all on function public.admin_get_plan_divergences() from anon;
grant execute on function public.admin_get_plan_divergences() to authenticated;

-- ============================================================================
-- C2. tenant_plan_usage(): helper interno, sem execução direta do cliente.
-- ============================================================================
revoke all on function public.tenant_plan_usage(uuid) from public;
revoke all on function public.tenant_plan_usage(uuid) from authenticated;

comment on function public.tenant_plan_usage(uuid) is
  'Helper interno (service_role / wrappers definer). Sem EXECUTE para anon/authenticated: '
  'o backoffice le unicamente via admin_get_tenant_plan (guard super_admin).';

-- ============================================================================
-- C3. Triggers PLAN_LIMIT passam a cobrir UPDATE (mesma lógica do INSERT).
-- ============================================================================
create or replace function public.enforce_professional_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan text;
  v_limit int;
  v_count int;
  v_self_counted boolean := false;
begin
  -- Desativar nunca precisa de limite.
  if coalesce(new.active, true) = false then
    return new;
  end if;
  if TG_OP = 'UPDATE'
    and coalesce(old.active, false) = true
    and old.tenant_id is not distinct from new.tenant_id then
    -- A linha já era ativa: ela mesma está incluída em v_count abaixo.
    v_self_counted := true;
  end if;
  select t.plan into v_plan from public.tenants t where t.id = new.tenant_id;
  if v_plan is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  v_limit := public.plan_professional_limit(v_plan);
  if v_limit is null then
    return new;
  end if;
  select count(*)::int into v_count from public.professionals p
    where p.tenant_id = new.tenant_id and p.active = true;
  if v_self_counted then
    -- UPDATE sem reativação: só nega se passar do teto (a linha já ocupava vaga).
    if v_count > v_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % profissional(is) ativo(s).',
        v_plan, v_limit using errcode = 'check_violation';
    end if;
  elsif v_count >= v_limit then
    raise exception 'PLAN_LIMIT: Limite do plano %: máximo % profissional(is) ativo(s).',
      v_plan, v_limit using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists professionals_plan_limit_trg on public.professionals;
create trigger professionals_plan_limit_trg
  before insert on public.professionals
  for each row
  execute function public.enforce_professional_plan_limit();

drop trigger if exists professionals_plan_limit_upd_trg on public.professionals;
create trigger professionals_plan_limit_upd_trg
  before update of active on public.professionals
  for each row
  execute function public.enforce_professional_plan_limit();

create or replace function public.enforce_appointment_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan text;
  v_tz text;
  v_limit int;
  v_count int;
  v_new_month text;
  v_self_counted boolean := false;
begin
  -- Cancelar/sair cancelado nunca precisa de limite: cancelado não conta.
  if coalesce(new.status, '') = 'cancelado' then
    return new;
  end if;
  select t.plan, t.timezone into v_plan, v_tz
  from public.tenants t where t.id = new.tenant_id;
  if v_plan is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  v_limit := public.plan_appointment_limit(v_plan);
  if v_limit is null then
    return new;
  end if;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');
  v_new_month := to_char((new.starts_at at time zone v_tz), 'YYYY-MM');
  if TG_OP = 'UPDATE'
    and coalesce(old.status, '') != 'cancelado'
    and old.tenant_id is not distinct from new.tenant_id
    and to_char((old.starts_at at time zone v_tz), 'YYYY-MM') = v_new_month then
    -- A linha OLD já era contada neste bucket mensal: ela mesma está em v_count.
    v_self_counted := true;
  end if;
  select count(*)::int into v_count from public.appointments a
    where a.tenant_id = new.tenant_id
      and a.status != 'cancelado'
      and to_char((a.starts_at at time zone v_tz), 'YYYY-MM') = v_new_month;
  if v_self_counted then
    if v_count > v_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % agendamentos por mês.',
        v_plan, v_limit using errcode = 'check_violation';
    end if;
  elsif v_count >= v_limit then
    raise exception 'PLAN_LIMIT: Limite do plano %: máximo % agendamentos por mês.',
      v_plan, v_limit using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_plan_limit_trg on public.appointments;
create trigger appointments_plan_limit_trg
  before insert on public.appointments
  for each row
  execute function public.enforce_appointment_plan_limit();

drop trigger if exists appointments_plan_limit_upd_trg on public.appointments;
create trigger appointments_plan_limit_upd_trg
  before update of status, starts_at on public.appointments
  for each row
  execute function public.enforce_appointment_plan_limit();
