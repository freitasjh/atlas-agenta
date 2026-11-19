-- Migration: depósito/sinal (ADR-03 Fase 4) — fluxo público, confirmação, expiração, reembolso.
-- Idempotente.

-- ============================================================================
-- 1. charges — charge_type (atendimento | deposito).
-- ============================================================================
alter table public.charges
  add column if not exists charge_type text not null default 'atendimento'
  check (charge_type in ('atendimento','deposito'));

create index if not exists charges_tenant_appointment_charge_type_idx
  on public.charges (tenant_id, appointment_id, charge_type);

create unique index if not exists charges_one_pending_deposit_per_appointment
  on public.charges (tenant_id, appointment_id)
  where status = 'pendente' and charge_type = 'deposito';

-- ============================================================================
-- 2. appointments — prazo de depósito.
-- ============================================================================
alter table public.appointments
  add column if not exists deposit_deadline_at timestamptz;

-- ============================================================================
-- 3. settle_charge_payment — depósito não cria receita; transiciona appointment.
-- ============================================================================
create or replace function public.settle_charge_payment(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_paid_at timestamptz,
  p_source text default 'asaas',
  p_actor_id uuid default null,
  p_event_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role   text;
  v_actor_active boolean;
  v_charge       public.charges%rowtype;
  v_payment      public.appointment_payments%rowtype;
  v_replayed     boolean := false;
  v_received_at  timestamptz;
  v_action       text;
begin
  if p_tenant_id is null or p_charge_id is null
     or p_source not in ('asaas', 'manual') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if p_source = 'asaas' then
    if p_actor_id is not null then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  else
    select pr.role, pr.active
      into v_actor_role, v_actor_active
      from public.profiles pr
     where pr.id = p_actor_id
       and pr.tenant_id = p_tenant_id;

    if not found or v_actor_active is not true or v_actor_role <> 'admin' then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  end if;

  select *
    into v_charge
    from public.charges
   where tenant_id = p_tenant_id
     and id = p_charge_id
     for update;

  if not found then
    raise exception 'CHARGE_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_charge.appointment_id is null then
    raise exception 'CHARGE_NOT_APPOINTMENT' using errcode = 'PT409';
  end if;

  -- Anomalias declaradas: nunca 5xx, nunca linha de receita.
  if v_charge.amount_cents <= 0 then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, p_actor_id, 'charge_invalid_amount', 'charge', v_charge.id,
      jsonb_build_object('event_id', p_event_id, 'amount_cents', v_charge.amount_cents)
    );
    return jsonb_build_object(
      'ok', true,
      'payment', null,
      'charge_status', v_charge.status,
      'replayed', false,
      'anomaly', 'charge_invalid_amount'
    );
  end if;

  if v_charge.status = 'cancelado' then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, p_actor_id, 'charge_paid_after_cancel', 'charge', v_charge.id,
      jsonb_build_object('event_id', p_event_id, 'amount_cents', v_charge.amount_cents)
    );
    return jsonb_build_object(
      'ok', true,
      'payment', null,
      'charge_status', v_charge.status,
      'replayed', false,
      'anomaly', 'charge_paid_after_cancel'
    );
  end if;

  v_received_at := coalesce(p_paid_at, now());

  if v_charge.status = 'pago' then
    -- Depósito não cria linha no ledger de recebimento (fonte única só na conclusão).
    if v_charge.charge_type = 'deposito' then
      v_replayed := true;
    else
      select *
        into v_payment
        from public.appointment_payments p
       where p.tenant_id = p_tenant_id
         and p.charge_id = v_charge.id;

      if found then
        v_replayed := true;
      else
        insert into public.appointment_payments (
          tenant_id, appointment_id, charge_id, method, amount_cents, tip_cents,
          source, received_at, received_by, idempotency_key, line_index, lote_signature
        )
        values (
          p_tenant_id, v_charge.appointment_id, v_charge.id, 'pix_sistema',
          v_charge.amount_cents, 0, p_source, v_received_at, p_actor_id, null, 0, null
        )
        returning * into v_payment;
      end if;
    end if;
  elsif v_charge.status in ('pendente', 'expirado') then
    if v_charge.charge_type <> 'deposito' then
      insert into public.appointment_payments (
        tenant_id, appointment_id, charge_id, method, amount_cents, tip_cents,
        source, received_at, received_by, idempotency_key, line_index, lote_signature
      )
      values (
        p_tenant_id, v_charge.appointment_id, v_charge.id, 'pix_sistema',
        v_charge.amount_cents, 0, p_source, v_received_at, p_actor_id, null, 0, null
      )
      on conflict (tenant_id, charge_id) where charge_id is not null do nothing
      returning * into v_payment;

      if v_payment.id is null then
        select *
          into v_payment
          from public.appointment_payments p
         where p.tenant_id = p_tenant_id
           and p.charge_id = v_charge.id;
        v_replayed := true;
      end if;
    end if;

    update public.charges
       set status = 'pago',
           paid_at = coalesce(paid_at, p_paid_at, now())
     where tenant_id = p_tenant_id
       and id = v_charge.id
       and status <> 'pago';
  end if;

  -- Depósito pago: transiciona appointment aguardando_deposito -> pendente (idempotente).
  if v_charge.charge_type = 'deposito' then
    update public.appointments
       set status = 'pendente'
     where tenant_id = p_tenant_id
       and id = v_charge.appointment_id
       and status = 'aguardando_deposito';
  end if;

  v_action := case when p_source = 'manual' then 'charge_paid_manual' else 'charge_paid' end;

  -- Em replay (charge já pago) não grava audit_log adicional (idempotência de auditoria).
  if not v_replayed then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, p_actor_id, v_action, 'charge', v_charge.id,
      jsonb_build_object(
        'event_id', p_event_id,
        'charge_id', v_charge.id,
        'appointment_id', v_charge.appointment_id,
        'amount_cents', v_charge.amount_cents,
        'source', p_source
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment', jsonb_build_object(
      'id', v_payment.id,
      'appointment_id', v_payment.appointment_id,
      'method', v_payment.method,
      'amount_cents', v_payment.amount_cents,
      'tip_cents', v_payment.tip_cents,
      'source', v_payment.source,
      'charge_id', v_payment.charge_id,
      'received_at', v_payment.received_at
    ),
    'charge_status', 'pago',
    'replayed', v_replayed,
    'anomaly', null
  );
end;
$$;

-- ============================================================================
-- 3) cancel_charge
-- ============================================================================
create or replace function public.cancel_charge(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_actor_id uuid,
  p_force boolean default false,
  p_gateway_cancelled boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_actor_active boolean;
  v_force boolean := coalesce(p_force, false);
  v_gateway boolean := coalesce(p_gateway_cancelled, false);
  v_charge public.charges%rowtype;
  v_action text;
begin
  if p_tenant_id is null or p_charge_id is null or p_actor_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select pr.role, pr.active
    into v_actor_role, v_actor_active
    from public.profiles pr
   where pr.id = p_actor_id
     and pr.tenant_id = p_tenant_id;

  if not found
     or v_actor_active is not true
     or v_actor_role not in ('admin', 'receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if v_force and v_actor_role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select *
    into v_charge
    from public.charges
   where tenant_id = p_tenant_id
     and id = p_charge_id
     for update;

  if not found then
    raise exception 'CHARGE_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_charge.status = 'cancelado' then
    return jsonb_build_object(
      'cancelled', true,
      'replayed', true,
      'charge_id', v_charge.id,
      'charge_status', v_charge.status,
      'gateway_divergence_risk', false
    );
  end if;

  if v_charge.status = 'pago' then
    raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
  end if;

  if not v_gateway and not (v_force and v_actor_role = 'admin') then
    raise exception 'GATEWAY_CANCEL_FAILED' using errcode = 'PT422';
  end if;

  update public.charges
     set status = 'cancelado',
         gateway_claimed_at = null,
         gateway_claim_expires_at = null
   where tenant_id = p_tenant_id
     and id = p_charge_id
     and status <> 'pago';

  v_action := case when v_force then 'charge_cancelled_forced' else 'charge_cancelled' end;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, p_actor_id, v_action, 'charge', v_charge.id,
    jsonb_build_object(
      'force', v_force,
      'gateway_cancelled', v_gateway,
      'actor_id', p_actor_id,
      'amount_cents', v_charge.amount_cents
    )
  );

  return jsonb_build_object(
    'cancelled', true,
    'replayed', false,
    'charge_id', v_charge.id,
    'charge_status', 'cancelado',
    'gateway_divergence_risk', v_force
  );
end;
$$;

-- ============================================================================
-- 4) void_appointment_payment — estorno lógico, sem DELETE e sem alterar valor.
-- ============================================================================
create or replace function public.void_appointment_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_actor_active boolean;
  v_reason text;
  v_payment public.appointment_payments%rowtype;
  v_replayed boolean := false;
  v_refund boolean;
  v_summary jsonb;
begin
  if p_tenant_id is null or p_payment_id is null or p_actor_id is null
     or p_reason is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_reason := btrim(p_reason);
  if length(v_reason) < 1 or length(v_reason) > 500 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select pr.role, pr.active
    into v_actor_role, v_actor_active
    from public.profiles pr
   where pr.id = p_actor_id
     and pr.tenant_id = p_tenant_id;

  if not found or v_actor_active is not true or v_actor_role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select *
    into v_payment
    from public.appointment_payments p
   where p.tenant_id = p_tenant_id
     and p.id = p_payment_id
     for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  v_refund := v_payment.charge_id is not null;

  if v_payment.voided_at is not null then
    v_replayed := true;
  else
    update public.appointment_payments
       set voided_at = now(),
           voided_by = p_actor_id,
           void_reason = v_reason
     where tenant_id = p_tenant_id
       and id = p_payment_id
     returning * into v_payment;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, p_actor_id, 'payment_voided', 'appointment_payment', v_payment.id,
      jsonb_build_object(
        'payment_id', v_payment.id,
        'charge_id', v_payment.charge_id,
        'amount_cents', v_payment.amount_cents,
        'tip_cents', v_payment.tip_cents,
        'reason', v_reason,
        'reason_length', length(v_reason)
      )
    );
  end if;

  v_summary := public.appointment_payment_summary(p_tenant_id, v_payment.appointment_id);

  return jsonb_build_object(
    'voided', true,
    'replayed', v_replayed,
    'refund_required', v_refund,
    'payment', jsonb_build_object(
      'id', v_payment.id,
      'charge_id', v_payment.charge_id,
      'amount_cents', v_payment.amount_cents,
      'tip_cents', v_payment.tip_cents,
      'voided_at', v_payment.voided_at,
      'void_reason', v_payment.void_reason
    ),
    'settlement', v_summary
  );
end;
$$;

-- ============================================================================
-- 5) Grants e comentários.
-- ============================================================================
revoke execute on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean)
  to service_role;

revoke execute on function public.settle_charge_payment(uuid, uuid, timestamptz, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.settle_charge_payment(uuid, uuid, timestamptz, text, uuid, text)
  to service_role;


-- ============================================================================
-- 4. expire_deposits
-- ============================================================================
create or replace function public.expire_deposits(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  v_row record;
begin
  if p_limit is null or p_limit <= 0 then
    p_limit := 100;
  end if;

  for v_row in
    select a.id as appointment_id, a.tenant_id, c.id as charge_id
      from public.appointments a
      join public.charges c
        on c.tenant_id = a.tenant_id
       and c.appointment_id = a.id
     where a.status = 'aguardando_deposito'
       and a.deposit_deadline_at is not null
       and a.deposit_deadline_at < now()
       and c.status = 'pendente'
       and c.charge_type = 'deposito'
     order by a.deposit_deadline_at asc
     limit p_limit
     for update of a skip locked
  loop
    update public.charges
       set status = 'expirado'
     where tenant_id = v_row.tenant_id
       and id = v_row.charge_id
       and status = 'pendente';

    update public.appointments
       set status = 'cancelado'
     where tenant_id = v_row.tenant_id
       and id = v_row.appointment_id
       and status = 'aguardando_deposito';

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      v_row.tenant_id, null, 'deposit_expired', 'appointment', v_row.appointment_id,
      jsonb_build_object('charge_id', v_row.charge_id, 'reason', 'deposito_nao_pago')
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_deposits(int) from public, anon, authenticated;
grant execute on function public.expire_deposits(int) to service_role;

-- ============================================================================
-- 5. cancel_deposit_appointment
-- Escopo (ADR-03): cancela o atendimento e a cobrança de depósito pendente.
-- Reembolso no gateway (charge já paga) é FORA DO ESCOPO deste ADR e fica
-- para ADR-07 (estorno de gateway). Quando a charge já está 'pago', ela
-- permanece paga — não há estorno automático aqui.
-- ============================================================================
create or replace function public.cancel_deposit_appointment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_refund_policy text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_actor_active boolean;
  v_charge public.charges%rowtype;
  v_policy text;
begin
  if p_tenant_id is null or p_appointment_id is null or p_actor_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select pr.role, pr.active
    into v_actor_role, v_actor_active
    from public.profiles pr
   where pr.id = p_actor_id
     and pr.tenant_id = p_tenant_id;

  if not found or v_actor_active is not true
     or v_actor_role not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select *
    into v_charge
    from public.charges
   where tenant_id = p_tenant_id
     and appointment_id = p_appointment_id
     and charge_type = 'deposito'
   order by created_at desc
   limit 1
   for update;

  v_policy := coalesce(p_refund_policy, 'none');

  if found then
    if v_charge.status = 'pendente' then
      update public.charges
         set status = 'cancelado'
       where tenant_id = p_tenant_id
         and id = v_charge.id
         and status = 'pendente';
    end if;
  end if;

  update public.appointments
     set status = 'cancelado'
   where tenant_id = p_tenant_id
     and id = p_appointment_id
     and status in ('aguardando_deposito','pendente','confirmado');

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, p_actor_id, 'deposit_cancelled', 'appointment', p_appointment_id,
    jsonb_build_object(
      'charge_id', v_charge.id,
      'refund_policy', v_policy,
      'charge_status', v_charge.status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'appointment_id', p_appointment_id,
    'charge_id', v_charge.id,
    'charge_status', v_charge.status,
    'refund_policy', v_policy
  );
end;
$$;

grant execute on function public.cancel_deposit_appointment(uuid, uuid, uuid, text) to authenticated;
