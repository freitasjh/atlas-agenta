-- Migration: backoffice plan control — troca de plano auditada + enforcement de limites (Fase 1)
-- SSoT: tenants.plan (individual/clinica/pro). Sem pending_plan/scheduler (Fase 3).
-- Idempotente (if not exists / drop if exists / create or replace). Nenhum segredo.
--
-- Conteúdo:
--  1. tenant_plan_changes (append-only, RLS select super_admin, zero write client)
--  2. CHECK subscription_charges.plan in (...) + comment (intenção, nunca aplica sozinha)
--  3. Parcial indexes + tenants trial defaults (trial/individual, trial_ends_at +14d)
--  4. RPC admin_set_tenant_plan (service role only) + admin_get_tenant_plan (super_admin guard)
--  5. Triggers BEFORE INSERT fail-closed PLAN_LIMIT (professionals active, appointments mês/fuso, inclui public_booking)
--  6. View v_charges_pagas_sem_plano (reconciliação webhook pago sem tocar plan)

-- ============================================================================
-- 1. tenant_plan_changes — trilha auditada de troca de plano.
-- ============================================================================
create table if not exists public.tenant_plan_changes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  changed_by  uuid references public.profiles (id) on delete set null,
  old_plan    text not null check (old_plan in ('individual','clinica','pro')),
  new_plan    text not null check (new_plan in ('individual','clinica','pro')),
  reason      text not null check (char_length(reason) between 10 and 280),
  override_flag boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists tenant_plan_changes_tenant_idx
  on public.tenant_plan_changes (tenant_id, created_at desc);

alter table public.tenant_plan_changes enable row level security;

drop policy if exists tenant_plan_changes_super_admin on public.tenant_plan_changes;
create policy tenant_plan_changes_super_admin
  on public.tenant_plan_changes for select
  using (current_role_name() = 'super_admin');

-- Nenhuma policy de INSERT/UPDATE/DELETE: append-only, escrita só service role via RPC.

-- ============================================================================
-- 2. subscription_charges.plan — intenção, nunca aplica sozinha. CHECK + comment.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscription_charges_plan_check'
  ) then
    alter table public.subscription_charges
      add constraint subscription_charges_plan_check
      check (plan is null or plan in ('individual','clinica','pro'));
  end if;
end $$;

comment on column public.subscription_charges.plan is
  'Intencao de plano da cobranca (nunca aplica sozinha em tenants.plan; webhook nunca toca plan).';

-- ============================================================================
-- 3. Índices parciais de enforcement + defaults de trial.
-- ============================================================================
create index if not exists appointments_active_month_idx
  on public.appointments (tenant_id, starts_at)
  where status != 'cancelado';

create index if not exists professionals_active_idx
  on public.professionals (tenant_id)
  where active = true;

-- Trial nasce trial/individual com trial_ends_at = created +14d (Fase 1: aplicado no INSERT).
create or replace function public.tenants_trial_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.subscription_status = 'trial' and new.trial_ends_at is null then
    new.trial_ends_at := coalesce(new.created_at, now()) + interval '14 days';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_trial_defaults_trg on public.tenants;
create trigger tenants_trial_defaults_trg
  before insert on public.tenants
  for each row
  execute function public.tenants_trial_defaults();

-- ============================================================================
-- 4. Helpers de limite + RPCs.
-- ============================================================================
create or replace function public.plan_professional_limit(p_plan text)
returns int
language sql
immutable
as $$
  select case p_plan
    when 'individual' then 1
    when 'clinica' then 5
    else null
  end;
$$;

create or replace function public.plan_appointment_limit(p_plan text)
returns int
language sql
immutable
as $$
  select case p_plan
    when 'individual' then 150
    else null
  end;
$$;

-- Uso atual do tenant: profissionais ativos + agendamentos do mês (fuso do tenant, exclui cancelado).
create or replace function public.tenant_plan_usage(p_tenant_id uuid)
returns table (plan text, active_professionals int, month_appointments int, month_key text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan text;
  v_tz text;
  v_month_key text;
begin
  select t.plan, t.timezone into v_plan, v_tz
  from public.tenants t where t.id = p_tenant_id;
  if v_plan is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');
  v_month_key := to_char((now() at time zone v_tz), 'YYYY-MM');

  return query
  select
    v_plan,
    (select count(*)::int from public.professionals p
      where p.tenant_id = p_tenant_id and p.active = true),
    (select count(*)::int from public.appointments a
      where a.tenant_id = p_tenant_id
        and a.status != 'cancelado'
        and to_char((a.starts_at at time zone v_tz), 'YYYY-MM') = v_month_key),
    v_month_key;
end;
$$;

comment on function public.tenant_plan_usage(uuid) is
  'Uso atual do plano: profissionais ativos + agendamentos do mes (fuso do tenant, exclui cancelado, inclui public_booking).';

revoke all on function public.tenant_plan_usage(uuid) from public;
revoke all on function public.tenant_plan_usage(uuid) from anon;
grant execute on function public.tenant_plan_usage(uuid) to authenticated;

-- Leitura de plano + uso para o backoffice (super_admin only, guard interno).
create or replace function public.admin_get_tenant_plan(p_tenant_id uuid)
returns table (plan text, active_professionals int, month_appointments int, month_key text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_role_name() is distinct from 'super_admin' then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.tenant_plan_usage(p_tenant_id);
end;
$$;

revoke all on function public.admin_get_tenant_plan(uuid) from public;
revoke all on function public.admin_get_tenant_plan(uuid) from anon;
grant execute on function public.admin_get_tenant_plan(uuid) to authenticated;

-- Troca de plano auditada e atômica. Só service role (Edge admin-plan).
-- Upgrade imediato sem validação de uso. Downgrade valida limites (grandfather:
-- dados acima preservados, novos creates bloqueados pelos triggers); acima do
-- limite exige p_override=true (double-confirm, auditado).
create or replace function public.admin_set_tenant_plan(
  p_tenant_id uuid,
  p_new_plan text,
  p_changed_by uuid,
  p_reason text,
  p_override boolean default false
)
returns table (old_plan text, new_plan text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old text;
  v_prof_count int;
  v_appt_count int;
  v_prof_limit int;
  v_appt_limit int;
  v_tz text;
  v_month_key text;
begin
  if p_new_plan not in ('individual','clinica','pro') then
    raise exception 'invalid_plan' using errcode = 'check_violation';
  end if;
  if p_reason is null or char_length(p_reason) < 10 then
    raise exception 'reason_too_short' using errcode = 'check_violation';
  end if;
  if char_length(p_reason) > 280 then
    raise exception 'reason_too_long' using errcode = 'check_violation';
  end if;

  select t.plan, t.timezone into v_old, v_tz
  from public.tenants t
  where t.id = p_tenant_id
  for update;
  if v_old is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  if v_old = p_new_plan then
    raise exception 'same_plan' using errcode = 'unique_violation';
  end if;

  -- Downgrade (ou qualquer troca para plano com limite): valida uso, salvo override.
  v_prof_limit := public.plan_professional_limit(p_new_plan);
  v_appt_limit := public.plan_appointment_limit(p_new_plan);
  if (v_prof_limit is not null or v_appt_limit is not null) and coalesce(p_override, false) = false then
    v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');
    v_month_key := to_char((now() at time zone v_tz), 'YYYY-MM');
    select count(*)::int into v_prof_count from public.professionals p
      where p.tenant_id = p_tenant_id and p.active = true;
    select count(*)::int into v_appt_count from public.appointments a
      where a.tenant_id = p_tenant_id
        and a.status != 'cancelado'
        and to_char((a.starts_at at time zone v_tz), 'YYYY-MM') = v_month_key;
    if v_prof_limit is not null and v_prof_count > v_prof_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % profissionais ativos (uso atual: %).',
        p_new_plan, v_prof_limit, v_prof_count using errcode = 'check_violation';
    end if;
    if v_appt_limit is not null and v_appt_count > v_appt_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % agendamentos por mês (uso atual: %).',
        p_new_plan, v_appt_limit, v_appt_count using errcode = 'check_violation';
    end if;
  end if;

  -- cancelado não limpa plano: status e plano são ortogonais; só o plano muda aqui.
  update public.tenants set plan = p_new_plan where id = p_tenant_id;

  insert into public.tenant_plan_changes
    (tenant_id, changed_by, old_plan, new_plan, reason, override_flag)
  values
    (p_tenant_id, p_changed_by, v_old, p_new_plan, p_reason, coalesce(p_override, false));

  return query select v_old, p_new_plan;
end;
$$;

comment on function public.admin_set_tenant_plan(uuid, text, uuid, text, boolean) is
  'Troca tenants.plan com trilha atomica em tenant_plan_changes (service role via Edge admin-plan). '
  'Upgrade imediato sem validacao de uso; downgrade valida limites salvo override=true (auditado). '
  'Status cancelado nao limpa plano.';

revoke all on function public.admin_set_tenant_plan(uuid, text, uuid, text, boolean) from public;
revoke all on function public.admin_set_tenant_plan(uuid, text, uuid, text, boolean) from authenticated;
revoke all on function public.admin_set_tenant_plan(uuid, text, uuid, text, boolean) from anon;

-- ============================================================================
-- 5. Triggers BEFORE INSERT fail-closed PLAN_LIMIT (pt-BR).
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
begin
  if coalesce(new.active, true) = false then
    return new;
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
  if v_count >= v_limit then
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
begin
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
  select count(*)::int into v_count from public.appointments a
    where a.tenant_id = new.tenant_id
      and a.status != 'cancelado'
      and to_char((a.starts_at at time zone v_tz), 'YYYY-MM')
        = to_char((new.starts_at at time zone v_tz), 'YYYY-MM');
  if v_count >= v_limit then
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

-- ============================================================================
-- 6. View de reconciliação: charge paga com plano divergente (webhook nunca toca plan).
-- ============================================================================
create or replace view public.v_charges_pagas_sem_plano as
select
  c.id as charge_id,
  c.tenant_id,
  c.plan as charge_plan,
  t.plan as current_plan,
  c.amount_cents,
  c.paid_at,
  c.created_at
from public.subscription_charges c
join public.tenants t on t.id = c.tenant_id
where c.status = 'pago'
  and c.plan is not null
  and c.plan != t.plan;
