-- Migration: Meu plano + checkout self-service (ADR-10 Fase 4).
--
-- Escopo: backend do "Meu plano" (uso vs quota, fatura/historico,
-- upgrade imediato / downgrade no fim do ciclo) + checkout via Asaas.
-- Reusa `plans` como SSoT; sem motor de entitlements novo.
--
-- Resposta a PRD pergunta 9 (timing): upgrade aplica o plano imediatamente
-- apos confirmacao do pagamento; downgrade agenda `scheduled_plan` com
-- efeito no inicio do mes seguinte (fim do ciclo) no fuso do tenant.
--
-- Idempotente (add column/if not exists, update condicional, create or
-- replace, insert on conflict/do nothing, drop/create policy, revoke antes
-- de grant). Nenhum segredo. Dinheiro em *_cents; tempo em timestamptz UTC.

-- ============================================================================
-- 1. Catálogo: chave `checkout_self_service` nos planos pagos.
--    `free` nao tem (RF-38: sem entitlement = checkout indisponivel + upsell).
-- ============================================================================
update public.plans
set features = features || '["checkout_self_service"]'::jsonb
where slug in ('starter', 'premium', 'enterprise')
  and not (features ? 'checkout_self_service');

-- ============================================================================
-- 2. tenants: plano agendado + vigencia (downgrade fim de ciclo).
-- ============================================================================
alter table public.tenants add column if not exists scheduled_plan text;
alter table public.tenants add column if not exists scheduled_effective_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenants_scheduled_plan_check'
      and conrelid = 'public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_scheduled_plan_check
      check (scheduled_plan is null
             or scheduled_plan in ('free','starter','premium','enterprise'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenants_scheduled_coherence_check'
      and conrelid = 'public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_scheduled_coherence_check
      check ((scheduled_plan is null) = (scheduled_effective_at is null));
  end if;
end $$;

create index if not exists tenants_scheduled_effective_at_idx
  on public.tenants (scheduled_effective_at)
  where scheduled_plan is not null;

-- ============================================================================
-- 3. subscription_charges: kind + idempotencia + vigencia.
-- ============================================================================
alter table public.subscription_charges
  add column if not exists kind text not null default 'renewal';
alter table public.subscription_charges
  add column if not exists idempotency_key text;
alter table public.subscription_charges
  add column if not exists effective_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscription_charges_kind_check'
      and conrelid = 'public.subscription_charges'::regclass
  ) then
    alter table public.subscription_charges
      add constraint subscription_charges_kind_check
      check (kind in ('renewal','upgrade','downgrade'));
  end if;
end $$;

create unique index if not exists subscription_charges_idempotency_key_uidx
  on public.subscription_charges (idempotency_key)
  where idempotency_key is not null;

create index if not exists subscription_charges_tenant_status_idx
  on public.subscription_charges (tenant_id, status);

-- ============================================================================
-- 4. Rank do ladder (free < starter < premium < enterprise).
-- ============================================================================
create or replace function public.plan_rank(p_plan text)
returns int
language sql
immutable
as $$
  select case p_plan
    when 'free' then 0
    when 'starter' then 1
    when 'premium' then 2
    when 'enterprise' then 3
    else -1
  end;
$$;

comment on function public.plan_rank(text) is
  'Rank do ladder neutro (ADR-10): free 0 < starter 1 < premium 2 < enterprise 3; '
  'desconhecido = -1. Decide upgrade imediato vs downgrade agendado.';

revoke all on function public.plan_rank(text) from public;
revoke all on function public.plan_rank(text) from anon, authenticated;
grant execute on function public.plan_rank(text) to authenticated;

-- ============================================================================
-- 5. Inicio do proximo ciclo (00:00 do dia 1 do mes seguinte no fuso do tenant,
--    devolvido em UTC). Base do `effective_at` do downgrade.
-- ============================================================================
create or replace function public.next_cycle_start_utc(p_tenant_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tz text;
begin
  select coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')
    into v_tz
  from public.tenants t
  where t.id = p_tenant_id;
  if v_tz is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  return ((date_trunc('month', (now() at time zone v_tz)) + interval '1 month') at time zone v_tz);
end;
$$;

comment on function public.next_cycle_start_utc(uuid) is
  'ADR-10: 00:00 do dia 1 do mes seguinte no fuso do tenant (UTC). '
  'Efetivacao do downgrade agendado (pergunta 9 do PRD).';

revoke all on function public.next_cycle_start_utc(uuid) from public;
revoke all on function public.next_cycle_start_utc(uuid) from anon, authenticated;
grant execute on function public.next_cycle_start_utc(uuid) to authenticated;

-- ============================================================================
-- 6. get_my_plan() — Meu plano do tenant chamador (RF-35/RF-36).
--    Base (plano, status, uso vs quota, agendado, estados) para qualquer papel
--    do tenant; fatura com valores (invoices) so para admin.
-- ============================================================================
create or replace function public.get_my_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tenant_id uuid := current_tenant_id();
  v_role text := current_role_name();
  v_t public.tenants%rowtype;
  v_plan jsonb;
  v_tz text;
  v_month_key text;
  v_profs int;
  v_appts int;
  v_prof_limit int;
  v_appt_limit int;
  v_has_checkout boolean;
  v_pending boolean;
  v_state text;
  v_invoices jsonb;
begin
  if v_tenant_id is null then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_t from public.tenants t where t.id = v_tenant_id;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
           'slug', p.slug,
           'name', p.name,
           'price_cents', p.price_cents,
           'prof_limit', p.prof_limit,
           'appt_limit', p.appt_limit,
           'features', p.features
         )
    into v_plan
  from public.plans p
  where p.slug = v_t.plan and p.active;

  v_tz := coalesce(nullif(v_t.timezone, ''), 'America/Sao_Paulo');
  v_month_key := to_char((now() at time zone v_tz), 'YYYY-MM');

  select count(*)::int into v_profs
  from public.professionals pr
  where pr.tenant_id = v_tenant_id and pr.active = true;

  select count(*)::int into v_appts
  from public.appointments a
  where a.tenant_id = v_tenant_id
    and a.status != 'cancelado'
    and to_char((a.starts_at at time zone v_tz), 'YYYY-MM') = v_month_key;

  v_prof_limit := public.plan_professional_limit(v_t.plan);
  v_appt_limit := public.plan_appointment_limit(v_t.plan);

  v_has_checkout := coalesce(
    (select p.features ? 'checkout_self_service'
     from public.plans p where p.slug = v_t.plan),
    false
  );

  select exists(
    select 1 from public.subscription_charges sc
    where sc.tenant_id = v_tenant_id and sc.status = 'pendente'
  ) into v_pending;

  v_state := case
    when v_t.subscription_status = 'bloqueado' then 'bloqueado'
    when v_t.subscription_status = 'cancelado' then 'cancelado'
    when v_t.scheduled_plan is not null then 'scheduled'
    when v_pending then 'pending_payment'
    when v_t.subscription_status = 'trial' then 'trial'
    when v_t.subscription_status = 'pendente' then 'pending'
    else 'active'
  end;

  if v_role = 'admin' then
    select coalesce(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb)
      into v_invoices
    from (
      select sc.id, sc.status, sc.amount_cents, sc.plan, sc.kind,
             sc.billing_period, sc.paid_at, sc.expires_at, sc.effective_at,
             sc.created_at
      from public.subscription_charges sc
      where sc.tenant_id = v_tenant_id
      order by sc.created_at desc
      limit 10
    ) t;
  else
    v_invoices := null;
  end if;

  return jsonb_build_object(
    'plan', v_plan,
    'plan_slug', v_t.plan,
    'subscription_status', v_t.subscription_status,
    'trial_ends_at', v_t.trial_ends_at,
    'usage', jsonb_build_object(
      'profs', v_profs,
      'prof_limit', v_prof_limit,
      'appts', v_appts,
      'appt_limit', v_appt_limit,
      'month_key', v_month_key
    ),
    'scheduled', case
      when v_t.scheduled_plan is null then null
      else jsonb_build_object(
        'plan', v_t.scheduled_plan,
        'effective_at', v_t.scheduled_effective_at
      )
    end,
    'entitlements', jsonb_build_object('checkoutSelfService', v_has_checkout),
    'can_checkout', (v_role = 'admin' and v_has_checkout
                     and v_t.subscription_status is distinct from 'cancelado'),
    'plan_state', v_state,
    'invoices', v_invoices
  );
end;
$$;

comment on function public.get_my_plan() is
  'ADR-10 (RF-35/RF-36): Meu plano do tenant chamador — plano (SSoT), status, '
  'uso vs quota no mes (fuso do tenant), agendado, entitlement '
  'checkoutSelfService, can_checkout (admin + entitlement + nao cancelado), '
  'plan_state (bloqueado|cancelado|scheduled|pending_payment|trial|pending|'
  'active) e invoices (ultimas 10, so admin).';

revoke all on function public.get_my_plan() from public;
revoke all on function public.get_my_plan() from anon;
grant execute on function public.get_my_plan() to authenticated;

-- ============================================================================
-- 7. get_my_invoices() — historico/fatura do tenant (admin; RF-35).
--    Sem blobs de PIX (QR/copia vao no retorno do checkout).
-- ============================================================================
create or replace function public.get_my_invoices(
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  status text,
  amount_cents int,
  plan text,
  kind text,
  billing_period text,
  paid_at timestamptz,
  expires_at timestamptz,
  effective_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tenant_id uuid := current_tenant_id();
  v_limit int;
  v_offset int;
begin
  if v_tenant_id is null
     or current_role_name() is distinct from 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  return query
  select sc.id, sc.status, sc.amount_cents, sc.plan, sc.kind,
         sc.billing_period, sc.paid_at, sc.expires_at, sc.effective_at,
         sc.created_at
  from public.subscription_charges sc
  where sc.tenant_id = v_tenant_id
  order by sc.created_at desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.get_my_invoices(int, int) is
  'ADR-10 (RF-35): fatura/historico do tenant chamador, so admin. '
  'Sem blobs de PIX. Levanta forbidden fora do papel admin.';

revoke all on function public.get_my_invoices(int, int) from public;
revoke all on function public.get_my_invoices(int, int) from anon;
grant execute on function public.get_my_invoices(int, int) to authenticated;

-- ============================================================================
-- 8. apply_subscription_payment() — liquidacao de assinatura (webhook/chamada
--    server-side). Idempotente: cobrança ja paga = no-op.
--    upgrade/renewal com plano maior: aplica imediatamente; downgrade: agenda
--    para o inicio do proximo ciclo (pergunta 9 do PRD). Nunca rebaixa pago.
-- ============================================================================
create or replace function public.apply_subscription_payment(p_charge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_charge public.subscription_charges%rowtype;
  v_old_plan text;
  v_old_status text;
  v_effective timestamptz;
begin
  select * into v_charge
  from public.subscription_charges sc
  where sc.id = p_charge_id
  for update;
  if not found then
    raise exception 'charge_not_found' using errcode = 'no_data_found';
  end if;

  if v_charge.status = 'pago' then
    return jsonb_build_object('applied', false, 'reason', 'already_paid');
  end if;
  if v_charge.status is distinct from 'pendente' then
    return jsonb_build_object('applied', false, 'reason', 'not_pending');
  end if;

  select t.plan, t.subscription_status
    into v_old_plan, v_old_status
  from public.tenants t
  where t.id = v_charge.tenant_id
  for update;
  if v_old_plan is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;

  update public.subscription_charges
  set status = 'pago',
      paid_at = coalesce(paid_at, now())
  where id = v_charge.id;

  if v_old_status is distinct from 'ativo' then
    update public.tenants
    set subscription_status = 'ativo'
    where id = v_charge.tenant_id;
    insert into public.subscription_status_changes
      (tenant_id, changed_by, old_status, new_status, reason)
    values
      (v_charge.tenant_id, null, v_old_status, 'ativo',
       'checkout asaas confirmado');
  end if;

  if v_charge.kind = 'downgrade'
     and v_charge.plan is not null
     and v_charge.plan is distinct from v_old_plan then
    v_effective := coalesce(
      v_charge.effective_at,
      public.next_cycle_start_utc(v_charge.tenant_id)
    );
    update public.tenants
    set scheduled_plan = v_charge.plan,
        scheduled_effective_at = v_effective
    where id = v_charge.tenant_id;
    insert into public.audit_log
      (tenant_id, action, target_type, target_id, metadata)
    values
      (v_charge.tenant_id, 'subscription_paid', 'subscription_charge',
       v_charge.id,
       jsonb_build_object('kind', 'downgrade', 'plan', v_charge.plan,
                          'effective_at', v_effective));
    return jsonb_build_object('applied', true, 'kind', 'downgrade',
                              'plan', v_charge.plan,
                              'scheduled_effective_at', v_effective);
  end if;

  if v_charge.plan is not null
     and v_charge.plan is distinct from v_old_plan
     and public.plan_rank(v_charge.plan) > public.plan_rank(v_old_plan) then
    update public.tenants
    set plan = v_charge.plan,
        scheduled_plan = null,
        scheduled_effective_at = null
    where id = v_charge.tenant_id;
    insert into public.tenant_plan_changes
      (tenant_id, changed_by, old_plan, new_plan, reason, override_flag)
    values
      (v_charge.tenant_id, null, v_old_plan, v_charge.plan,
       'checkout self-service: upgrade imediato confirmado', false);
  end if;

  insert into public.audit_log
    (tenant_id, action, target_type, target_id, metadata)
  values
    (v_charge.tenant_id, 'subscription_paid', 'subscription_charge',
     v_charge.id,
     jsonb_build_object('kind', v_charge.kind, 'plan', v_charge.plan));

  return jsonb_build_object('applied', true, 'kind', v_charge.kind,
                            'plan', v_charge.plan);
end;
$$;

comment on function public.apply_subscription_payment(uuid) is
  'ADR-10: liquidacao idempotente de subscription_charges (webhook Asaas ou '
  'caminho server-side). Upgrade com plano maior aplica imediatamente; '
  'downgrade agenda scheduled_plan no inicio do proximo ciclo (PRD pergunta 9). '
  'Pago nunca e rebaixado; trilha em subscription_status_changes, '
  'tenant_plan_changes e audit_log.';

revoke all on function public.apply_subscription_payment(uuid) from public;
revoke all on function public.apply_subscription_payment(uuid) from authenticated;
revoke all on function public.apply_subscription_payment(uuid) from anon;

-- ============================================================================
-- 9. apply_due_scheduled_plans() — efetiva downgrades vencidos.
--    Chamada oportunista pelo webhook + documentada para cron mensal.
--    Com uso acima do limite do plano destino: pula (mantem agendado) e
--    audita, sem aplicar plano inconsistente.
-- ============================================================================
create or replace function public.apply_due_scheduled_plans()
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_applied int := 0;
  v_tz text;
  v_month_key text;
  v_prof_count int;
  v_appt_count int;
  v_prof_limit int;
  v_appt_limit int;
begin
  for r in
    select t.id, t.plan, t.scheduled_plan, t.timezone
    from public.tenants t
    where t.scheduled_plan is not null
      and t.scheduled_effective_at is not null
      and t.scheduled_effective_at <= now()
    for update of t skip locked
  loop
    v_prof_limit := public.plan_professional_limit(r.scheduled_plan);
    v_appt_limit := public.plan_appointment_limit(r.scheduled_plan);
    if v_prof_limit is not null or v_appt_limit is not null then
      v_tz := coalesce(nullif(r.timezone, ''), 'America/Sao_Paulo');
      v_month_key := to_char((now() at time zone v_tz), 'YYYY-MM');
      select count(*)::int into v_prof_count
      from public.professionals p
      where p.tenant_id = r.id and p.active = true;
      select count(*)::int into v_appt_count
      from public.appointments a
      where a.tenant_id = r.id
        and a.status != 'cancelado'
        and to_char((a.starts_at at time zone v_tz), 'YYYY-MM') = v_month_key;
      if (v_prof_limit is not null and v_prof_count > v_prof_limit)
         or (v_appt_limit is not null and v_appt_count > v_appt_limit) then
        insert into public.audit_log
          (tenant_id, action, target_type, target_id, metadata)
        values
          (r.id, 'scheduled_plan_skipped_over_limit', 'tenant', r.id,
           jsonb_build_object('scheduled_plan', r.scheduled_plan,
                              'profs', v_prof_count,
                              'prof_limit', v_prof_limit,
                              'appts', v_appt_count,
                              'appt_limit', v_appt_limit));
        continue;
      end if;
    end if;

    update public.tenants
    set plan = r.scheduled_plan,
        scheduled_plan = null,
        scheduled_effective_at = null
    where id = r.id;

    insert into public.tenant_plan_changes
      (tenant_id, changed_by, old_plan, new_plan, reason, override_flag)
    values
      (r.id, null, r.plan, r.scheduled_plan,
       'downgrade agendado efetivado no inicio do ciclo', false);

    v_applied := v_applied + 1;
  end loop;
  return v_applied;
end;
$$;

comment on function public.apply_due_scheduled_plans() is
  'ADR-10: efetiva downgrades com effective_at vencido (skip locked). '
  'Com uso acima do limite do destino: pula e audita '
  'scheduled_plan_skipped_over_limit. Chamada oportunista pelo webhook; '
  'cron mensal recomendado.';

revoke all on function public.apply_due_scheduled_plans() from public;
revoke all on function public.apply_due_scheduled_plans() from authenticated;
revoke all on function public.apply_due_scheduled_plans() from anon;
