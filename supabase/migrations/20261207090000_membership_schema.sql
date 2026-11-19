-- Migration: ADR-04 — membership schema + RPCs (planos, adesão, cobrança, inadimplência).
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Escopo (ADR-04): membership_plans / membership_subscriptions / membership_charges +
-- RPCs subscribe / charge_cycle / settle / mark_overdue / update_status. Sem UI (ADR-05),
-- sem tocar o catálogo SaaS `plans` (tabela distinta: `membership_plans` é por tenant) e sem
-- tocar o ledger `appointment_payments` (cobrança recorrente é gateway-only; receita de
-- membership NÃO entra no ledger — categoria própria DRE em ADR-09).
--
-- PRD §4/§7: Financeiro é admin-only; recepção/profissional SEM leitura (policies negam;
-- sem policy ≠ admin, qualquer SELECT pelo cliente é barrado por RLS). Escrita direta pelo
-- cliente: nenhuma (sem policy de write); mutações só via RPCs SECURITY DEFINER com gate
-- interno de papel, ou via service_role (webhook/cron bypassa RLS).
--
-- Decisões (PRD §10.4–10.5 delegadas):
--   - Membership vs pacotes/cupons: NÃO acumula — membership é recorrência por plano,
--     pacotes são créditos de sessões; domínios separados, sem vínculo entre tabelas.
--   - Dias p/ pausa automática: sem default duro no banco — `mark_overdue` só marca
--     `inadimplente`; a transição inadimplente→pausada é manual (config de tenant em ADR-05+).
--   - Bloqueio de agendamento por inadimplência: NÃO implementado aqui (decisão de produto
--     pendente; o schema não impede agendar).
--   - Recepção adere? NÃO — adesão/cobrança é admin-only (PRD §4: recepção sem Financeiro;
--     adesão operacional segue via pacotes, domínio existente).
--
-- Convenções: inglês/snake_case/plural; *_cents; timestamptz UTC; FK composta por tenant;
-- security definer + search_path fixo; erros de domínio PT4xx com message = código estável.

-- ============================================================================
-- 1) membership_plans — plano recorrente do tenant (≠ catálogo SaaS `plans`).
-- ============================================================================
create table if not exists public.membership_plans (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default current_tenant_id()
                   references public.tenants (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  amount_cents   int  not null check (amount_cents > 0),
  billing_period text not null check (billing_period in ('mensal','trimestral','anual')),
  active         bool not null default true,
  created_at     timestamptz not null default now(),
  constraint membership_plans_tenant_id_unique unique (tenant_id, id)
);

create index if not exists membership_plans_tenant_id_idx
  on public.membership_plans (tenant_id);

alter table public.membership_plans enable row level security;

-- Leitura: só admin do tenant. Recepção/profissional sem leitura (PRD §4).
drop policy if exists membership_plans_select_admin on public.membership_plans;
create policy membership_plans_select_admin on public.membership_plans
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.membership_plans from anon, authenticated;
grant select on table public.membership_plans to authenticated;
grant all on table public.membership_plans to service_role;
revoke truncate on table public.membership_plans from anon, authenticated;

-- ============================================================================
-- 2) membership_subscriptions — adesão do cliente ao plano.
-- ============================================================================
create table if not exists public.membership_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default current_tenant_id()
                     references public.tenants (id) on delete cascade,
  customer_id      uuid not null,
  plan_id          uuid not null,
  status           text not null default 'ativa'
                     check (status in ('ativa','inadimplente','pausada','cancelada')),
  next_charge_at   timestamptz,
  created_at       timestamptz not null default now(),
  constraint membership_subscriptions_tenant_id_unique unique (tenant_id, id),
  constraint membership_subscriptions_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint membership_subscriptions_plan_fk
    foreign key (tenant_id, plan_id)
    references public.membership_plans (tenant_id, id) on delete restrict
);

create index if not exists membership_subscriptions_tenant_id_idx
  on public.membership_subscriptions (tenant_id);
create index if not exists membership_subscriptions_customer_idx
  on public.membership_subscriptions (tenant_id, customer_id);

-- 1 ativa/inadimplente por (customer, plan): adesão não duplica (volta a existente).
create unique index if not exists membership_subscriptions_customer_plan_uidx
  on public.membership_subscriptions (tenant_id, customer_id, plan_id)
  where status in ('ativa','inadimplente');

alter table public.membership_subscriptions enable row level security;

drop policy if exists membership_subscriptions_select_admin on public.membership_subscriptions;
create policy membership_subscriptions_select_admin on public.membership_subscriptions
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.membership_subscriptions from anon, authenticated;
grant select on table public.membership_subscriptions to authenticated;
grant all on table public.membership_subscriptions to service_role;
revoke truncate on table public.membership_subscriptions from anon, authenticated;

-- ============================================================================
-- 3) membership_charges — cobrança por ciclo (1 pendente por ciclo).
-- ============================================================================
create table if not exists public.membership_charges (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default current_tenant_id()
                      references public.tenants (id) on delete cascade,
  subscription_id   uuid not null,
  cycle_ref         text not null check (cycle_ref ~ '^[0-9]{4}-[0-9]{2}$'),
  amount_cents      int  not null check (amount_cents > 0),
  status            text not null default 'pendente'
                      check (status in ('pendente','pago','vencido','cancelado')),
  asaas_payment_id  text,
  due_at            timestamptz not null default now() + interval '3 days',
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  constraint membership_charges_tenant_id_unique unique (tenant_id, id),
  constraint membership_charges_subscription_fk
    foreign key (tenant_id, subscription_id)
    references public.membership_subscriptions (tenant_id, id) on delete restrict
);

create index if not exists membership_charges_tenant_id_idx
  on public.membership_charges (tenant_id);
create index if not exists membership_charges_subscription_idx
  on public.membership_charges (tenant_id, subscription_id);
-- Fila de vencidas do cron: só pendentes com vencimento passado.
create index if not exists membership_charges_overdue_idx
  on public.membership_charges (due_at)
  where status = 'pendente';

-- 1 linha não-cancelada por (subscription, ciclo): 1 pendente por ciclo.
create unique index if not exists membership_charges_cycle_uidx
  on public.membership_charges (tenant_id, subscription_id, cycle_ref)
  where status <> 'cancelado';

-- Dedupe de webhook: 1 cobrança por pagamento Asaas (padrão charges existente).
create unique index if not exists membership_charges_asaas_uidx
  on public.membership_charges (asaas_payment_id)
  where asaas_payment_id is not null;

alter table public.membership_charges enable row level security;

drop policy if exists membership_charges_select_admin on public.membership_charges;
create policy membership_charges_select_admin on public.membership_charges
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.membership_charges from anon, authenticated;
grant select on table public.membership_charges to authenticated;
grant all on table public.membership_charges to service_role;
revoke truncate on table public.membership_charges from anon, authenticated;

-- ============================================================================
-- 4) membership_subscribe — adesão (admin): cria subscription ativa + 1ª cobrança.
--    Idempotente: adesão existente ativa/inadimplente volta (sem duplicar).
-- ============================================================================
create or replace function public.membership_subscribe(
  p_customer_id uuid,
  p_plan_id uuid,
  p_cycle_ref text default to_char(now(), 'YYYY-MM')
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_plan   public.membership_plans%rowtype;
  v_sub    public.membership_subscriptions%rowtype;
  v_charge uuid;
begin
  if p_customer_id is null or p_plan_id is null
     or p_cycle_ref is null or p_cycle_ref !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if not exists (
    select 1 from public.customers c
     where c.tenant_id = v_tenant and c.id = p_customer_id
  ) then
    raise exception 'MEMBERSHIP_CUSTOMER_NOT_FOUND' using errcode = 'PT404';
  end if;

  select * into v_plan
    from public.membership_plans p
   where p.tenant_id = v_tenant and p.id = p_plan_id;
  if not found then
    raise exception 'MEMBERSHIP_PLAN_NOT_FOUND' using errcode = 'PT404';
  end if;
  if not v_plan.active then
    raise exception 'MEMBERSHIP_PLAN_INACTIVE' using errcode = 'PT409';
  end if;

  -- Adesão existente (ativa/inadimplente pelo unique parcial) volta sem duplicar.
  select * into v_sub
    from public.membership_subscriptions s
   where s.tenant_id = v_tenant
     and s.customer_id = p_customer_id
     and s.plan_id = p_plan_id
     and s.status in ('ativa','inadimplente');
  if found then
    perform public.membership_charge_cycle(v_sub.id, p_cycle_ref);
    return v_sub.id;
  end if;

  insert into public.membership_subscriptions (tenant_id, customer_id, plan_id, status)
  values (v_tenant, p_customer_id, p_plan_id, 'ativa')
  on conflict (tenant_id, customer_id, plan_id)
    where status in ('ativa','inadimplente') do nothing
  returning * into v_sub;

  if v_sub.id is null then
    select * into v_sub
      from public.membership_subscriptions s
     where s.tenant_id = v_tenant
       and s.customer_id = p_customer_id
       and s.plan_id = p_plan_id
       and s.status in ('ativa','inadimplente');
  end if;

  v_charge := public.membership_charge_cycle(v_sub.id, p_cycle_ref);

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'membership_subscribed', 'membership_subscription', v_sub.id,
    jsonb_build_object('customer_id', p_customer_id, 'plan_id', p_plan_id, 'charge_id', v_charge)
  );

  return v_sub.id;
end;
$$;

revoke all on function public.membership_subscribe(uuid, uuid, text) from public, anon;
grant execute on function public.membership_subscribe(uuid, uuid, text) to authenticated, service_role;

-- ============================================================================
-- 5) membership_charge_cycle — cobrança do ciclo (admin): idempotente por ciclo.
-- ============================================================================
create or replace function public.membership_charge_cycle(
  p_subscription_id uuid,
  p_cycle_ref text default to_char(now(), 'YYYY-MM')
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_sub    public.membership_subscriptions%rowtype;
  v_plan   public.membership_plans%rowtype;
  v_charge uuid;
begin
  if p_subscription_id is null
     or p_cycle_ref is null or p_cycle_ref !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_sub
    from public.membership_subscriptions s
   where s.tenant_id = v_tenant and s.id = p_subscription_id
   for update;
  if not found then
    raise exception 'MEMBERSHIP_SUBSCRIPTION_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_sub.status = 'cancelada' then
    raise exception 'MEMBERSHIP_SUBSCRIPTION_CANCELLED' using errcode = 'PT409';
  end if;

  select * into v_plan
    from public.membership_plans p
   where p.tenant_id = v_tenant and p.id = v_sub.plan_id;
  if not found then
    raise exception 'MEMBERSHIP_PLAN_NOT_FOUND' using errcode = 'PT404';
  end if;

  insert into public.membership_charges
    (tenant_id, subscription_id, cycle_ref, amount_cents, status)
  values
    (v_tenant, v_sub.id, p_cycle_ref, v_plan.amount_cents, 'pendente')
  on conflict (tenant_id, subscription_id, cycle_ref)
    where status <> 'cancelado' do nothing
  returning id into v_charge;

  if v_charge is null then
    select c.id into v_charge
      from public.membership_charges c
     where c.tenant_id = v_tenant
       and c.subscription_id = v_sub.id
       and c.cycle_ref = p_cycle_ref
       and c.status <> 'cancelado';
  end if;

  return v_charge;
end;
$$;

revoke all on function public.membership_charge_cycle(uuid, text) from public, anon;
grant execute on function public.membership_charge_cycle(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 6) membership_settle_charge — liquidação via webhook Asaas (só service_role).
--    Replay (já pago / mesmo evento) volta sem duplicar.
-- ============================================================================
create or replace function public.membership_settle_charge(
  p_charge_id uuid,
  p_asaas_payment_id text,
  p_event_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_charge public.membership_charges%rowtype;
begin
  if p_charge_id is null or p_asaas_payment_id is null
     or length(btrim(p_asaas_payment_id)) = 0 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_charge
    from public.membership_charges c
   where c.id = p_charge_id
   for update;

  if not found then
    raise exception 'MEMBERSHIP_CHARGE_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Replay: mesma cobrança já liquidada com o mesmo pagamento → sem efeito.
  if v_charge.status = 'pago' and v_charge.asaas_payment_id = p_asaas_payment_id then
    return jsonb_build_object('charge_id', v_charge.id, 'settled', false, 'replayed', true);
  end if;

  if v_charge.status = 'pago' then
    raise exception 'MEMBERSHIP_CHARGE_ALREADY_PAID' using errcode = 'PT409';
  end if;

  if v_charge.status = 'cancelado' then
    raise exception 'MEMBERSHIP_CHARGE_CANCELLED' using errcode = 'PT409';
  end if;

  -- Colisão: pagamento Asaas já vinculado a OUTRA cobrança (webhook duplicado cruzado).
  if exists (
    select 1 from public.membership_charges c
     where c.asaas_payment_id = p_asaas_payment_id
       and c.id <> v_charge.id
  ) then
    raise exception 'MEMBERSHIP_PAYMENT_CONFLICT' using errcode = 'PT409';
  end if;

  update public.membership_charges
     set status = 'pago',
         asaas_payment_id = p_asaas_payment_id,
         paid_at = now()
   where id = v_charge.id
  returning * into v_charge;

  update public.membership_subscriptions
     set status = 'ativa'
   where tenant_id = v_charge.tenant_id
     and id = v_charge.subscription_id
     and status = 'inadimplente';

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_charge.tenant_id, null, 'membership_charge_settled', 'membership_charge', v_charge.id,
    jsonb_build_object(
      'subscription_id', v_charge.subscription_id,
      'cycle_ref', v_charge.cycle_ref,
      'amount_cents', v_charge.amount_cents,
      'event_id', p_event_id
    )
  );

  return jsonb_build_object('charge_id', v_charge.id, 'settled', true, 'replayed', false);
end;
$$;

revoke all on function public.membership_settle_charge(uuid, text, text) from public, anon, authenticated;
grant execute on function public.membership_settle_charge(uuid, text, text) to service_role;

-- ============================================================================
-- 7) membership_mark_overdue — cron (só service_role): pendente vencida →
--    `vencido` + subscription `inadimplente` + fila WhatsApp só com opt-in.
-- ============================================================================
create or replace function public.membership_mark_overdue()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_overdue   int := 0;
  v_subs      int := 0;
  v_queued    int := 0;
  v_skipped   int := 0;
  v_rec       record;
begin
  -- 1) Pendentes vencidas viram `vencido` (lock por linha; pago/cancelado intocados).
  with expired as (
    update public.membership_charges c
       set status = 'vencido'
     where c.status = 'pendente'
       and c.due_at < now()
    returning c.id, c.tenant_id, c.subscription_id
  )
  select count(*) into v_overdue from expired;

  -- 2) Subscriptions com cobrança vencida: ativa → inadimplente.
  with affected as (
    update public.membership_subscriptions s
       set status = 'inadimplente'
      from public.membership_charges c
     where c.subscription_id = s.id
       and c.tenant_id = s.tenant_id
       and c.status = 'vencido'
       and s.status = 'ativa'
    returning s.id
  )
  select count(*) into v_subs from affected;

  -- 3) Régua WhatsApp: fila `cobranca` só com opt-in; sem opt-in → sem mensagem.
  for v_rec in
    select c.id as charge_id, c.tenant_id, c.subscription_id,
           c.cycle_ref, c.amount_cents, s.customer_id,
           cu.whatsapp_opt_in
      from public.membership_charges c
      join public.membership_subscriptions s
        on s.tenant_id = c.tenant_id and s.id = c.subscription_id
      join public.customers cu
        on cu.tenant_id = c.tenant_id and cu.id = s.customer_id
     where c.status = 'vencido'
       and not exists (
         select 1 from public.messages m
          where m.tenant_id = c.tenant_id
            and m.dedupe_key = 'membership-charge-' || c.id::text
            and m.status in ('fila','enviado','entregue')
       )
  loop
    if v_rec.whatsapp_opt_in is true then
      insert into public.messages (tenant_id, customer_id, template, payload, dedupe_key)
      values (
        v_rec.tenant_id, v_rec.customer_id, 'cobranca',
        jsonb_build_object(
          'subscription_id', v_rec.subscription_id,
          'charge_id', v_rec.charge_id,
          'cycle_ref', v_rec.cycle_ref,
          'amount_cents', v_rec.amount_cents
        ),
        'membership-charge-' || v_rec.charge_id::text
      )
      on conflict do nothing;
      if found then
        v_queued := v_queued + 1;
      end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    null, null, 'membership_mark_overdue', null, null,
    jsonb_build_object('overdue', v_overdue, 'subscriptions', v_subs, 'queued', v_queued, 'skipped_no_optin', v_skipped)
  );

  return jsonb_build_object(
    'overdue', v_overdue, 'subscriptions', v_subs,
    'queued', v_queued, 'skipped_no_optin', v_skipped
  );
end;
$$;

revoke all on function public.membership_mark_overdue() from public, anon, authenticated;
grant execute on function public.membership_mark_overdue() to service_role;

-- ============================================================================
-- 8) membership_update_status — pausar/retomar/cancelar (admin).
--    Transições: ativa↔pausada, ativa/inadimplente/pausada→cancelada.
--    inadimplente→ativa só via liquidação (settle); cancelada é terminal.
-- ============================================================================
create or replace function public.membership_update_status(
  p_subscription_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_sub    public.membership_subscriptions%rowtype;
begin
  if p_subscription_id is null
     or p_status is null
     or p_status not in ('ativa','pausada','cancelada') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_sub
    from public.membership_subscriptions s
   where s.tenant_id = v_tenant and s.id = p_subscription_id
   for update;
  if not found then
    raise exception 'MEMBERSHIP_SUBSCRIPTION_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_sub.status = 'cancelada' then
    raise exception 'MEMBERSHIP_SUBSCRIPTION_CANCELLED' using errcode = 'PT409';
  end if;

  if v_sub.status = 'inadimplente' and p_status = 'ativa' then
    raise exception 'MEMBERSHIP_SETTLE_REQUIRED' using errcode = 'PT409';
  end if;

  if v_sub.status = 'inadimplente' and p_status = 'pausada' then
    raise exception 'MEMBERSHIP_SETTLE_REQUIRED' using errcode = 'PT409';
  end if;

  if p_status = 'cancelada'
     and (p_reason is null or length(btrim(p_reason)) = 0) then
    raise exception 'MEMBERSHIP_CANCEL_REASON_REQUIRED' using errcode = 'PT400';
  end if;

  update public.membership_subscriptions
     set status = p_status
   where tenant_id = v_tenant and id = p_subscription_id
  returning * into v_sub;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'membership_status_changed', 'membership_subscription', v_sub.id,
    jsonb_build_object('to_status', p_status, 'reason', p_reason)
  );

  return jsonb_build_object('subscription_id', v_sub.id, 'status', v_sub.status);
end;
$$;

revoke all on function public.membership_update_status(uuid, text, text) from public, anon;
grant execute on function public.membership_update_status(uuid, text, text) to authenticated, service_role;
