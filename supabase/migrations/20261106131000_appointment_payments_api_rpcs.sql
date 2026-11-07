-- Migration: ADR-002 — RPCs privilegiadas de escrita financeira.
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Funções (execute só service_role; security invoker; search_path fixo):
--   register_appointment_payments  — lote manual + conclusão atômica (RF-02/03/05/06/07)
--   settle_charge_payment          — única forma de criar receita PIX (RF-09)
--   cancel_charge                  — cancelamento local com gate do gateway (RF-10)
--   void_appointment_payment       — estorno lógico (RF-11)
--
-- Erros de domínio: SQLSTATE PT4xx + message = código estável (SPEC §7). Nenhum
-- valor, id, SQL ou PII na mensagem.

-- ============================================================================
-- 1) register_appointment_payments
-- ============================================================================
create or replace function public.register_appointment_payments(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_appointment_id uuid,
  p_payments jsonb,
  p_idempotency_key uuid,
  p_close_appointment boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role        text;
  v_actor_active      boolean;
  v_appt              public.appointments%rowtype;
  v_item              jsonb;
  v_method            text;
  v_amount            int;
  v_tip               int;
  v_count             int := 0;
  v_pix_count         int := 0;
  v_pix_intent        int := 0;
  v_manual_sum        int := 0;
  v_signature         text;
  v_pending           public.charges%rowtype;
  v_has_pending       boolean := false;
  v_price             int;
  v_paid              int;
  v_reserved          int;
  v_pix_for_balance   int := 0;
  v_existing_count    int;
  v_existing_sig      text;
  v_replay            boolean := false;
  v_appointment_status text;
  v_summary           jsonb;
  v_lines             jsonb;
  v_rec               record;
begin
  -- 1) Parâmetros e forma do array.
  if p_tenant_id is null or p_actor_id is null or p_appointment_id is null
     or p_idempotency_key is null or p_payments is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if jsonb_array_length(p_payments) > 10 then
    raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
  end if;

  -- 2) Ator ativo no tenant com papel operacional.
  select pr.role, pr.active
    into v_actor_role, v_actor_active
    from public.profiles pr
   where pr.id = p_actor_id
     and pr.tenant_id = p_tenant_id;

  if not found
     or v_actor_active is not true
     or v_actor_role not in ('admin', 'receptionist', 'professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  -- 3) Validação dos itens do lote.
  for v_item in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    if (v_item - 'method' - 'amount_cents' - 'tip_cents') <> '{}'::jsonb then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    if not (v_item ? 'method') or not (v_item ? 'amount_cents') then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    v_method := v_item ->> 'method';
    if v_method not in (
      'dinheiro', 'cartao_credito', 'cartao_debito', 'pix_sistema', 'pix_maquininha'
    ) then
      raise exception 'INVALID_METHOD' using errcode = 'PT400';
    end if;

    if jsonb_typeof(v_item -> 'amount_cents') <> 'number' then
      raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
    end if;

    if (v_item ->> 'amount_cents')::numeric <> trunc((v_item ->> 'amount_cents')::numeric)
       or (v_item ->> 'amount_cents')::numeric <= 0
       or (v_item ->> 'amount_cents')::numeric > 2147483647 then
      raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
    end if;
    v_amount := (v_item ->> 'amount_cents')::int;

    if v_item ? 'tip_cents' then
      if jsonb_typeof(v_item -> 'tip_cents') <> 'number' then
        raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
      end if;

      if (v_item ->> 'tip_cents')::numeric <> trunc((v_item ->> 'tip_cents')::numeric)
         or (v_item ->> 'tip_cents')::numeric < 0
         or (v_item ->> 'tip_cents')::numeric > 2147483647 then
        raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
      end if;
      v_tip := (v_item ->> 'tip_cents')::int;
    else
      v_tip := 0;
    end if;

    if v_method = 'pix_sistema' then
      v_pix_count := v_pix_count + 1;
      if v_pix_count > 1 then
        raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
      end if;
      v_pix_intent := v_amount;
    else
      v_count := v_count + 1;
      v_manual_sum := v_manual_sum + v_amount;
    end if;
  end loop;

  -- 4) Array vazio só é válido concluindo o atendimento.
  if jsonb_array_length(p_payments) = 0 and p_close_appointment is not true then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Assinatura canônica do lote (hash; nunca o payload).
  select md5(jsonb_build_object(
           'v', 1,
           'close', (p_close_appointment is true),
           'pix', coalesce(v_pix_intent, 0),
           'items', (
             select jsonb_agg(
                      jsonb_build_array(
                        e.value ->> 'method',
                        (e.value ->> 'amount_cents')::int,
                        coalesce((e.value ->> 'tip_cents')::int, 0)
                      )
                      order by e.value ->> 'method',
                               (e.value ->> 'amount_cents')::int,
                               coalesce((e.value ->> 'tip_cents')::int, 0)
                    )
               from jsonb_array_elements(p_payments) e
              where e.value ->> 'method' <> 'pix_sistema'
           )
         )::text)
    into v_signature;

  -- 5) Lock do atendimento.
  select *
    into v_appt
    from public.appointments
   where tenant_id = p_tenant_id
     and id = p_appointment_id
     for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- 6) Profissional só o próprio atendimento.
  if v_actor_role = 'professional'
     and not exists (
       select 1 from public.professionals p
        where p.tenant_id = p_tenant_id
          and p.id = v_appt.professional_id
          and p.profile_id = p_actor_id
     ) then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  -- 7) Estados aceitos.
  if v_appt.status not in ('em_atendimento', 'concluido') then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;

  if v_appt.status = 'em_atendimento' and p_close_appointment is not true then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;

  -- Cobrança pendente do atendimento (para PIX e saldo).
  select *
    into v_pending
    from public.charges c
   where c.tenant_id = p_tenant_id
     and c.appointment_id = p_appointment_id
     and c.status = 'pendente'
     and (c.expires_at is null or c.expires_at > now())
   order by c.created_at desc
   limit 1;
  v_has_pending := found;

  -- 8) Idempotência por lote.
  if exists (
    select 1 from public.appointment_payments p
     where p.tenant_id = p_tenant_id
       and p.idempotency_key = p_idempotency_key
       and p.appointment_id <> p_appointment_id
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
  end if;

  select count(*), min(p.lote_signature)
    into v_existing_count, v_existing_sig
    from public.appointment_payments p
   where p.tenant_id = p_tenant_id
     and p.appointment_id = p_appointment_id
     and p.idempotency_key = p_idempotency_key;

  if v_existing_count > 0 then
    if v_existing_count <> v_count or v_existing_sig is distinct from v_signature then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
    end if;
    v_replay := true;
  end if;

  if v_replay then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'method', p.method,
                 'amount_cents', p.amount_cents,
                 'tip_cents', p.tip_cents,
                 'source', p.source
               )
               order by p.line_index
             ),
             '[]'::jsonb
           )
      into v_lines
      from public.appointment_payments p
     where p.tenant_id = p_tenant_id
       and p.appointment_id = p_appointment_id
       and p.idempotency_key = p_idempotency_key;

    v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
    return jsonb_build_object(
      'appointment_id', p_appointment_id,
      'appointment_status', v_appt.status,
      'payments', v_lines,
      'total_paid_cents', coalesce((v_summary ->> 'total_paid_cents')::int, 0),
      'tip_cents', coalesce((v_summary ->> 'tip_cents')::int, 0),
      'reserved_cents', coalesce((v_summary ->> 'reserved_cents')::int, 0),
      'remaining_cents', coalesce((v_summary ->> 'remaining_cents')::int, 0),
      'payment_status', v_summary ->> 'payment_status',
      'pix_amount_cents', coalesce(v_pix_intent, 0),
      'pix_already_pending', v_has_pending,
      'replayed', true
    );
  end if;

  -- Concluído + close=true sem replay => já concluído (D-08).
  if v_appt.status = 'concluido' and p_close_appointment is true then
    raise exception 'APPOINTMENT_ALREADY_CONCLUDED' using errcode = 'PT409';
  end if;

  -- 9) PIX: valor divergente de cobrança pendente é conflito.
  if v_pix_count = 1 and v_has_pending and v_pending.amount_cents <> v_pix_intent then
    raise exception 'PENDING_CHARGE_EXISTS' using errcode = 'PT409';
  end if;
  if v_pix_count = 1 and not v_has_pending then
    v_pix_for_balance := v_pix_intent;
  end if;

  -- 10) Saldo calculado sob o lock, com o summary como fonte única.
  v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
  v_price := coalesce((v_summary ->> 'price_cents')::int, 0);
  v_paid := coalesce((v_summary ->> 'total_paid_cents')::int, 0);
  v_reserved := coalesce((v_summary ->> 'reserved_cents')::int, 0);

  if v_paid + v_reserved + v_manual_sum + v_pix_for_balance > v_price then
    raise exception 'AMOUNT_EXCEEDS_REMAINING' using errcode = 'PT409';
  end if;

  -- 11) Linhas não-PIX no mesmo commit da conclusão.
  if v_count > 0 then
    insert into public.appointment_payments (
      tenant_id, appointment_id, method, amount_cents, tip_cents, source,
      idempotency_key, line_index, received_at, received_by, lote_signature
    )
    select
      p_tenant_id,
      p_appointment_id,
      e.value ->> 'method',
      (e.value ->> 'amount_cents')::int,
      coalesce((e.value ->> 'tip_cents')::int, 0),
      'manual',
      p_idempotency_key,
      (e.ordinality - 1)::smallint,
      now(),
      p_actor_id,
      v_signature
    from jsonb_array_elements(p_payments) with ordinality as e(value, ordinality)
    where e.value ->> 'method' <> 'pix_sistema'
    on conflict (tenant_id, idempotency_key, line_index)
      where idempotency_key is not null do nothing;

    select count(*), min(p.lote_signature)
      into v_existing_count, v_existing_sig
      from public.appointment_payments p
     where p.tenant_id = p_tenant_id
       and p.appointment_id = p_appointment_id
       and p.idempotency_key = p_idempotency_key;

    if v_existing_count <> v_count or v_existing_sig is distinct from v_signature then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
    end if;
  end if;

  if p_close_appointment is true and v_appt.status = 'em_atendimento' then
    update public.appointments
       set status = 'concluido'
     where tenant_id = p_tenant_id
       and id = p_appointment_id;
    v_appointment_status := 'concluido';
  else
    v_appointment_status := v_appt.status;
  end if;

  -- 12) Auditoria (uma linha por recebimento; sem PII).
  if v_count > 0 then
    for v_rec in
      select * from public.appointment_payments p
       where p.tenant_id = p_tenant_id
         and p.appointment_id = p_appointment_id
         and p.idempotency_key = p_idempotency_key
       order by p.line_index
    loop
      insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
      values (
        p_tenant_id, p_actor_id, 'payment_registered', 'appointment_payment', v_rec.id,
        jsonb_build_object(
          'appointment_id', p_appointment_id,
          'method', v_rec.method,
          'amount_cents', v_rec.amount_cents,
          'tip_cents', v_rec.tip_cents,
          'source', v_rec.source,
          'idempotency_key', p_idempotency_key
        )
      );
    end loop;
  end if;

  if jsonb_array_length(p_payments) = 0 and p_close_appointment is true then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, p_actor_id, 'appointment_concluded_without_payment',
      'appointment', p_appointment_id,
      jsonb_build_object(
        'appointment_id', p_appointment_id,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  -- 13) Retorno congelado, com o summary recalculado após as escritas.
  v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'method', p.method,
               'amount_cents', p.amount_cents,
               'tip_cents', p.tip_cents,
               'source', p.source
             )
             order by p.line_index
           ),
           '[]'::jsonb
         )
    into v_lines
    from public.appointment_payments p
   where p.tenant_id = p_tenant_id
     and p.appointment_id = p_appointment_id
     and p.idempotency_key = p_idempotency_key;

  return jsonb_build_object(
    'appointment_id', p_appointment_id,
    'appointment_status', v_appointment_status,
    'payments', v_lines,
    'total_paid_cents', coalesce((v_summary ->> 'total_paid_cents')::int, 0),
    'tip_cents', coalesce((v_summary ->> 'tip_cents')::int, 0),
    'reserved_cents', coalesce((v_summary ->> 'reserved_cents')::int, 0),
    'remaining_cents', coalesce((v_summary ->> 'remaining_cents')::int, 0),
    'payment_status', v_summary ->> 'payment_status',
    'pix_amount_cents', coalesce(v_pix_intent, 0),
    'pix_already_pending', v_has_pending,
    'replayed', false
  );
end;
$$;

-- ============================================================================
-- 2) settle_charge_payment — única forma de criar receita PIX.
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
  elsif v_charge.status in ('pendente', 'expirado') then
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

    update public.charges
       set status = 'pago',
           paid_at = coalesce(paid_at, p_paid_at, now())
     where tenant_id = p_tenant_id
       and id = v_charge.id
       and status <> 'pago';
  end if;

  v_action := case when p_source = 'manual' then 'charge_paid_manual' else 'charge_paid' end;

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
     set status = 'cancelado'
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

revoke execute on function public.cancel_charge(uuid, uuid, uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.cancel_charge(uuid, uuid, uuid, boolean, boolean)
  to service_role;

revoke execute on function public.void_appointment_payment(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.void_appointment_payment(uuid, uuid, uuid, text)
  to service_role;

comment on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean) is
  'ADR-002: registra lote manual e conclui o atendimento no mesmo commit (idempotente por lote).';
comment on function public.settle_charge_payment(uuid, uuid, timestamptz, text, uuid, text) is
  'ADR-002: única forma de criar receita PIX; nunca rebaixa charges.status=pago.';
comment on function public.cancel_charge(uuid, uuid, uuid, boolean, boolean) is
  'ADR-002: cancela cobrança pendente/expirada; force só admin e auditado.';
comment on function public.void_appointment_payment(uuid, uuid, uuid, text) is
  'ADR-002: estorno lógico com motivo obrigatório; linha permanece no histórico.';
