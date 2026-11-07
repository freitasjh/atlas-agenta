-- Migration: ADR-002 — base de leitura e primitivas de cobrança da API privilegiada.
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Entrega:
--   1. appointment_payments.lote_signature (hash do lote; D-01) — extensão aditiva do ledger.
--   2. appointment_payment_summary — fonte única de paid/tip/reserved/remaining/payment_status.
--   3. reserve_appointment_charge — reserva a cobrança PIX sob o mesmo lock do atendimento.
--   4. attach_charge_gateway_data — anexa dados do gateway à reserva.
--
-- Regras comuns (SPEC §3.1):
--   * security invoker, search_path = public, pg_temp;
--   * execute revogado de public/anon/authenticated e concedido só a service_role;
--   * erros de domínio = SQLSTATE PT4xx com message apenas o código estável;
--   * nenhum grant novo em tabela.

-- ============================================================================
-- 1) Extensão aditiva do ledger: hash canônico do lote (D-01).
--    Hash (md5) evita persistir qualquer payload financeiro/PII (I14).
-- ============================================================================
alter table public.appointment_payments
  add column if not exists lote_signature text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointment_payments'::regclass
       and conname = 'appointment_payments_lote_signature_check'
  ) then
    alter table public.appointment_payments
      add constraint appointment_payments_lote_signature_check
      check (lote_signature is null or lote_signature ~ '^[0-9a-f]{32}$');
  end if;
end;
$$;

-- ============================================================================
-- 2) appointment_payment_summary — fonte única do saldo e do estado financeiro.
--    Retorna null quando o atendimento não existe no tenant.
-- ============================================================================
create or replace function public.appointment_payment_summary(
  p_tenant_id uuid,
  p_appointment_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with appt as (
    select a.id, a.tenant_id, a.price_cents
      from public.appointments a
     where a.tenant_id = p_tenant_id
       and a.id = p_appointment_id
  ),
  paid as (
    select coalesce(sum(p.amount_cents), 0)::int as paid_cents,
           coalesce(sum(p.tip_cents), 0)::int as tip_cents
      from public.appointment_payments p
     where p.tenant_id = p_tenant_id
       and p.appointment_id = p_appointment_id
       and p.voided_at is null
  ),
  pending as (
    select c.id, c.amount_cents
      from public.charges c
     where c.tenant_id = p_tenant_id
       and c.appointment_id = p_appointment_id
       and c.status = 'pendente'
       and (c.expires_at is null or c.expires_at > now())
     order by c.created_at desc
     limit 1
  )
  select case
    when a.id is null then null
    else jsonb_build_object(
      'price_cents', a.price_cents,
      'total_paid_cents', p.paid_cents,
      'tip_cents', p.tip_cents,
      'reserved_cents', coalesce((select amount_cents from pending), 0),
      'remaining_cents', greatest(
        a.price_cents
          - p.paid_cents
          - coalesce((select amount_cents from pending), 0),
        0
      ),
      'payment_status', case
        when a.price_cents = 0 and p.paid_cents = 0 then 'quitado'
        when p.paid_cents >= a.price_cents then 'quitado'
        when exists (select 1 from pending) then 'aguardando_pix'
        when p.paid_cents = 0 then 'sem_pagamento'
        else 'parcial'
      end,
      'pending_charge_id', (select id from pending),
      'pending_charge_amount_cents', coalesce((select amount_cents from pending), 0)
    )
  end
    from appt a
    cross join paid p;
$$;

-- ============================================================================
-- 3) reserve_appointment_charge — reserva (intenção) da cobrança PIX.
--    Trava o atendimento ANTES de calcular saldo: mesmo lock de
--    register_appointment_payments (fecha D-06 / RF-15).
--
--    Regras:
--      * ator ativo no tenant (admin|receptionist|professional); profissional só o próprio;
--      * atendimento precisa estar 'concluido';
--      * cobrança existente é reapresentada/retomada, nunca duplicada;
--      * valor nulo usa o saldo restante; saldo 0 => AMOUNT_EXCEEDS_REMAINING;
--      * auditoria 'charge_reserved' na MESMA transação (falha => rollback).
-- ============================================================================
create or replace function public.reserve_appointment_charge(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_appointment_id uuid,
  p_amount_cents int default null,
  p_idempotency_key uuid default null,
  p_expires_at timestamptz default now() + interval '3 days'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role   text;
  v_actor_active boolean;
  v_appt         public.appointments%rowtype;
  v_charge       public.charges%rowtype;
  v_summary      jsonb;
  v_paid         int;
  v_reserved     int;
  v_price        int;
  v_remaining    int;
  v_amount       int;
  v_expires      timestamptz;
begin
  if p_tenant_id is null or p_actor_id is null or p_appointment_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

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

  -- Lock único do atendimento (mesma linha usada por register).
  select *
    into v_appt
    from public.appointments
   where tenant_id = p_tenant_id
     and id = p_appointment_id
     for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_actor_role = 'professional'
     and not exists (
       select 1 from public.professionals p
        where p.tenant_id = p_tenant_id
          and p.id = v_appt.professional_id
          and p.profile_id = p_actor_id
     ) then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  if v_appt.status <> 'concluido' then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;

  -- Reuso de chave de idempotência em outro atendimento é conflito.
  if p_idempotency_key is not null
     and exists (
       select 1 from public.charges c
        where c.tenant_id = p_tenant_id
          and c.idempotency_key = p_idempotency_key
          and c.appointment_id is distinct from p_appointment_id
     ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
  end if;

  select *
    into v_charge
    from public.charges
   where tenant_id = p_tenant_id
     and appointment_id = p_appointment_id
     for update;

  if found then
    if v_charge.status = 'pendente' then
      -- Reapresenta a cobrança pendente (com ou sem gateway já anexado).
      return jsonb_build_object(
        'charge_id', v_charge.id,
        'amount_cents', v_charge.amount_cents,
        'status', v_charge.status,
        'asaas_payment_id', v_charge.asaas_payment_id,
        'pix_qr_code', v_charge.pix_qr_code,
        'pix_copy_paste', v_charge.pix_copy_paste,
        'expires_at', v_charge.expires_at,
        'reused', true,
        'reopened', false,
        'requested_amount_mismatch',
          (p_amount_cents is not null and p_amount_cents <> v_charge.amount_cents)
      );
    elsif v_charge.status = 'cancelado'
          and v_charge.asaas_payment_id is null
          and p_idempotency_key is not null
          and v_charge.idempotency_key is not distinct from p_idempotency_key then
      if p_amount_cents is not null and p_amount_cents <> v_charge.amount_cents then
        raise exception 'PENDING_CHARGE_EXISTS' using errcode = 'PT409';
      end if;

      update public.charges
         set status = 'pendente',
             expires_at = coalesce(p_expires_at, now() + interval '3 days')
       where tenant_id = p_tenant_id
         and id = v_charge.id
       returning * into v_charge;

      insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
      values (
        p_tenant_id, p_actor_id, 'charge_reserved', 'charge', v_charge.id,
        jsonb_build_object(
          'appointment_id', p_appointment_id,
          'charge_id', v_charge.id,
          'amount_cents', v_charge.amount_cents,
          'idempotency_key', p_idempotency_key,
          'expires_at', v_charge.expires_at,
          'reopened', true
        )
      );

      return jsonb_build_object(
        'charge_id', v_charge.id,
        'amount_cents', v_charge.amount_cents,
        'status', v_charge.status,
        'asaas_payment_id', v_charge.asaas_payment_id,
        'pix_qr_code', v_charge.pix_qr_code,
        'pix_copy_paste', v_charge.pix_copy_paste,
        'expires_at', v_charge.expires_at,
        'reused', false,
        'reopened', true,
        'requested_amount_mismatch', false
      );
    else
      raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
    end if;
  end if;

  -- Sem cobrança: calcula saldo DEPOIS do lock.
  v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
  v_price := coalesce((v_summary ->> 'price_cents')::int, 0);
  v_paid := coalesce((v_summary ->> 'total_paid_cents')::int, 0);
  v_reserved := coalesce((v_summary ->> 'reserved_cents')::int, 0);
  v_remaining := greatest(v_price - v_paid - v_reserved, 0);
  v_amount := coalesce(p_amount_cents, v_remaining);

  if v_amount is null or v_amount <= 0
     or v_paid + v_reserved + v_amount > v_price then
    raise exception 'AMOUNT_EXCEEDS_REMAINING' using errcode = 'PT409';
  end if;

  v_expires := coalesce(p_expires_at, now() + interval '3 days');

  insert into public.charges (
    tenant_id, appointment_id, amount_cents, status, idempotency_key, expires_at
  )
  values (
    p_tenant_id, p_appointment_id, v_amount, 'pendente', p_idempotency_key, v_expires
  )
  on conflict (tenant_id, appointment_id) where appointment_id is not null do nothing
  returning * into v_charge;

  if v_charge.id is null then
    -- Corrida: outra chamada criou a cobrança. Relê sob lock e reapresenta.
    select *
      into v_charge
      from public.charges
     where tenant_id = p_tenant_id
       and appointment_id = p_appointment_id
       for update;

    if v_charge.status = 'pendente' then
      return jsonb_build_object(
        'charge_id', v_charge.id,
        'amount_cents', v_charge.amount_cents,
        'status', v_charge.status,
        'asaas_payment_id', v_charge.asaas_payment_id,
        'pix_qr_code', v_charge.pix_qr_code,
        'pix_copy_paste', v_charge.pix_copy_paste,
        'expires_at', v_charge.expires_at,
        'reused', true,
        'reopened', false,
        'requested_amount_mismatch',
          (p_amount_cents is not null and p_amount_cents <> v_charge.amount_cents)
      );
    end if;

    raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, p_actor_id, 'charge_reserved', 'charge', v_charge.id,
    jsonb_build_object(
      'appointment_id', p_appointment_id,
      'charge_id', v_charge.id,
      'amount_cents', v_charge.amount_cents,
      'idempotency_key', p_idempotency_key,
      'expires_at', v_charge.expires_at
    )
  );

  return jsonb_build_object(
    'charge_id', v_charge.id,
    'amount_cents', v_charge.amount_cents,
    'status', v_charge.status,
    'asaas_payment_id', v_charge.asaas_payment_id,
    'pix_qr_code', v_charge.pix_qr_code,
    'pix_copy_paste', v_charge.pix_copy_paste,
    'expires_at', v_charge.expires_at,
    'reused', false,
    'reopened', false,
    'requested_amount_mismatch', false
  );
end;
$$;

-- ============================================================================
-- 4) attach_charge_gateway_data — anexa id/QR/copia-e-cola à reserva pendente.
--    Idempotente quando os três campos já coincidem; auditoria sem QR/PII.
-- ============================================================================
create or replace function public.attach_charge_gateway_data(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_actor_id uuid,
  p_asaas_payment_id text,
  p_pix_qr_code text,
  p_pix_copy_paste text
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
begin
  if p_tenant_id is null or p_charge_id is null or p_actor_id is null
     or p_asaas_payment_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

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

  select *
    into v_charge
    from public.charges
   where tenant_id = p_tenant_id
     and id = p_charge_id
     for update;

  if not found then
    raise exception 'CHARGE_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_actor_role = 'professional'
     and not exists (
       select 1
         from public.professionals p
         join public.appointments a
           on a.tenant_id = p.tenant_id and a.professional_id = p.id
        where p.tenant_id = p_tenant_id
          and p.profile_id = p_actor_id
          and a.id = v_charge.appointment_id
     ) then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  if v_charge.status <> 'pendente' then
    raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
  end if;

  if v_charge.asaas_payment_id is distinct from p_asaas_payment_id
     or v_charge.pix_qr_code is distinct from p_pix_qr_code
     or v_charge.pix_copy_paste is distinct from p_pix_copy_paste then
    update public.charges
       set asaas_payment_id = p_asaas_payment_id,
           pix_qr_code = p_pix_qr_code,
           pix_copy_paste = p_pix_copy_paste
     where tenant_id = p_tenant_id
       and id = p_charge_id
     returning * into v_charge;
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, p_actor_id, 'charge_created', 'charge', v_charge.id,
    jsonb_build_object(
      'appointment_id', v_charge.appointment_id,
      'charge_id', v_charge.id,
      'amount_cents', v_charge.amount_cents,
      'idempotency_key', v_charge.idempotency_key,
      'expires_at', v_charge.expires_at
    )
  );

  return jsonb_build_object(
    'charge_id', v_charge.id,
    'amount_cents', v_charge.amount_cents,
    'status', v_charge.status,
    'asaas_payment_id', v_charge.asaas_payment_id,
    'pix_qr_code', v_charge.pix_qr_code,
    'pix_copy_paste', v_charge.pix_copy_paste,
    'expires_at', v_charge.expires_at
  );
end;
$$;

-- ============================================================================
-- 5) Grants: nenhuma função executável por public/anon/authenticated.
-- ============================================================================
revoke execute on function public.appointment_payment_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.appointment_payment_summary(uuid, uuid)
  to service_role;

revoke execute on function public.reserve_appointment_charge(uuid, uuid, uuid, int, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_appointment_charge(uuid, uuid, uuid, int, uuid, timestamptz)
  to service_role;

revoke execute on function public.attach_charge_gateway_data(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_charge_gateway_data(uuid, uuid, uuid, text, text, text)
  to service_role;

comment on function public.appointment_payment_summary(uuid, uuid) is
  'ADR-002: fonte única de paid/tip/reserved/remaining/payment_status por atendimento.';
comment on function public.reserve_appointment_charge(uuid, uuid, uuid, int, uuid, timestamptz) is
  'ADR-002: reserva a cobrança PIX sob o mesmo lock do atendimento (saldo + idempotência).';
comment on function public.attach_charge_gateway_data(uuid, uuid, uuid, text, text, text) is
  'ADR-002: anexa asaas_payment_id/QR/copia-e-cola à reserva pendente, sem PII na auditoria.';
