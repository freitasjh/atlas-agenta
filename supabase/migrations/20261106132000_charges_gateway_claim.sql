-- Migration: ADR-002 review lot — claim de criação no gateway, reemissão de PIX e
-- colisão de idempotency_key antes da escrita.
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Entrega:
--   1. charges.gateway_claimed_at / gateway_claim_expires_at + índice parcial.
--   2. claim_charge_gateway — claim atômico por cobrança (1 POST /payments no gateway).
--   3. attach_charge_gateway_data — só grava com o token do claim (fencing);
--      zero linhas => GATEWAY_CLAIM_LOST. cancel_charge — limpa o claim.
--   4. reopen_charge_for_reissue — reabre cobrança expirada/cancelada para novo QR.
--   5. reserve_appointment_charge — reemissão explícita (nunca para pago).
--   6. release_charge_reservation — libera a reserva local após falha de gateway
--      (com fence: recusa claim vivo de outro criador).
--   7. register_appointment_payments — colisão de idempotency_key em charges antes do lote.
--
-- Regras comuns (SPEC §3.1): security invoker, search_path fixo, execute só service_role,
-- erro de domínio PT4xx com message = código estável, nenhuma PII na auditoria.

-- ============================================================================
-- 1) Claim de criação no gateway (1 POST /payments por charges).
-- ============================================================================
alter table public.charges
  add column if not exists gateway_claimed_at timestamptz;
alter table public.charges
  add column if not exists gateway_claim_expires_at timestamptz;

create index if not exists charges_gateway_claim_expires_idx
  on public.charges (gateway_claim_expires_at)
  where status = 'pendente' and asaas_payment_id is null;

create or replace function public.claim_charge_gateway(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_ttl_seconds int default 180
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_charge public.charges%rowtype;
  v_ttl    int;
  v_payload jsonb;
begin
  if p_tenant_id is null or p_charge_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- TTL precisa cobrir o pior caso de I/O da Edge (~120s em 6 chamadas de 20s).
  v_ttl := greatest(1, least(coalesce(p_ttl_seconds, 180), 900));

  update public.charges c
     set gateway_claimed_at = now(),
         gateway_claim_expires_at = now() + make_interval(secs => v_ttl)
   where c.tenant_id = p_tenant_id
     and c.id = p_charge_id
     and c.status = 'pendente'
     and c.asaas_payment_id is null
     and (c.expires_at is null or c.expires_at > now())
     and (
       c.gateway_claimed_at is null
       or c.gateway_claim_expires_at is null
       or c.gateway_claim_expires_at < now()
     )
  returning * into v_charge;

  if v_charge.id is not null then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, null, 'charge_gateway_claimed', 'charge', v_charge.id,
      jsonb_build_object(
        'appointment_id', v_charge.appointment_id,
        'charge_id', v_charge.id,
        'claim_expires_at', v_charge.gateway_claim_expires_at
      )
    );

    v_payload := jsonb_build_object(
      'claimed', true,
      'claim_token', v_charge.gateway_claimed_at,
      'charge', jsonb_build_object(
        'charge_id', v_charge.id,
        'amount_cents', v_charge.amount_cents,
        'status', v_charge.status,
        'asaas_payment_id', v_charge.asaas_payment_id,
        'pix_qr_code', v_charge.pix_qr_code,
        'pix_copy_paste', v_charge.pix_copy_paste,
        'expires_at', v_charge.expires_at,
        'gateway_claimed_at', v_charge.gateway_claimed_at,
        'gateway_claim_expires_at', v_charge.gateway_claim_expires_at
      )
    );
    return v_payload;
  end if;

  select *
    into v_charge
    from public.charges
   where tenant_id = p_tenant_id
     and id = p_charge_id;

  if not found then
    raise exception 'CHARGE_NOT_FOUND' using errcode = 'PT404';
  end if;

  return jsonb_build_object(
    'claimed', false,
    'claim_token', null,
    'charge', jsonb_build_object(
      'charge_id', v_charge.id,
      'amount_cents', v_charge.amount_cents,
      'status', v_charge.status,
      'asaas_payment_id', v_charge.asaas_payment_id,
      'pix_qr_code', v_charge.pix_qr_code,
      'pix_copy_paste', v_charge.pix_copy_paste,
      'expires_at', v_charge.expires_at,
      'gateway_claimed_at', v_charge.gateway_claimed_at,
      'gateway_claim_expires_at', v_charge.gateway_claim_expires_at
    )
  );
end;
$$;

-- ============================================================================
-- 2) reopen_charge_for_reissue — reabre a MESMA linha para novo QR.
--    Só expirado/cancelado. Nunca chamado para pago.
-- ============================================================================
create or replace function public.reopen_charge_for_reissue(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_charge public.charges%rowtype;
  v_previous_status text;
  v_previous_asaas_id text;
  v_expires timestamptz;
begin
  if p_tenant_id is null or p_charge_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
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

  -- Criador em voo: não reabre, não limpa claim, não muda nada.
  if v_charge.gateway_claimed_at is not null
     and v_charge.gateway_claim_expires_at is not null
     and v_charge.gateway_claim_expires_at > now() then
    raise exception 'GATEWAY_IN_PROGRESS' using errcode = 'PT409';
  end if;

  if v_charge.status not in ('expirado', 'cancelado') then
    raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
  end if;

  v_previous_status := v_charge.status;
  v_previous_asaas_id := v_charge.asaas_payment_id;
  v_expires := coalesce(p_expires_at, now() + interval '3 days');

  update public.charges
     set status = 'pendente',
         expires_at = v_expires,
         asaas_payment_id = null,
         pix_qr_code = null,
         pix_copy_paste = null,
         idempotency_key = null,
         gateway_claimed_at = null,
         gateway_claim_expires_at = null
   where tenant_id = p_tenant_id
     and id = p_charge_id
   returning * into v_charge;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, null, 'charge_reissued', 'charge', v_charge.id,
    jsonb_build_object(
      'appointment_id', v_charge.appointment_id,
      'charge_id', v_charge.id,
      'amount_cents', v_charge.amount_cents,
      'previous_status', v_previous_status,
      'had_asaas_payment_id', (v_previous_asaas_id is not null),
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
    'reopened', true,
    'reissue', false,
    'requested_amount_mismatch', false
  );
end;
$$;

-- ============================================================================
-- 3) reserve_appointment_charge — reemissão explícita.
--    * pendente ativa            -> reapresenta (reused=true)
--    * pendente vencida          -> marca expirado e devolve reissue=true
--    * expirado / cancelado      -> devolve reissue=true (Edge cancela o anterior)
--    * pago                      -> CHARGE_NOT_PENDING (nunca reemite)
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
  v_attempt      int;
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

  -- Até 2 voltas: a segunda cobre a corrida do insert (unique por atendimento).
  for v_attempt in 1..2 loop
    select *
      into v_charge
      from public.charges
     where tenant_id = p_tenant_id
       and appointment_id = p_appointment_id
       for update;

    if found then
      if v_charge.status = 'pago' then
        raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
      end if;

      -- Claim vivo de outro criador: nenhuma alteração (nem expirar).
      if v_charge.gateway_claimed_at is not null
         and v_charge.gateway_claim_expires_at is not null
         and v_charge.gateway_claim_expires_at > now() then
        raise exception 'GATEWAY_IN_PROGRESS' using errcode = 'PT409';
      end if;

      if v_charge.status = 'pendente'
         and (v_charge.expires_at is null or v_charge.expires_at > now()) then
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
          'reissue', false,
          'requested_amount_mismatch',
            (p_amount_cents is not null and p_amount_cents <> v_charge.amount_cents)
        );
      end if;

      -- Pendente vencida vira expirado; expirado/cancelado seguem para reemissão.
      if v_charge.status = 'pendente' then
        update public.charges
           set status = 'expirado'
         where tenant_id = p_tenant_id
           and id = v_charge.id
         returning * into v_charge;

        insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
        values (
          p_tenant_id, p_actor_id, 'charge_expired', 'charge', v_charge.id,
          jsonb_build_object(
            'appointment_id', p_appointment_id,
            'charge_id', v_charge.id,
            'amount_cents', v_charge.amount_cents,
            'expires_at', v_charge.expires_at
          )
        );
      end if;

      -- A reemissão mantém o valor da linha; nunca muda o valor em silêncio.
      if p_amount_cents is not null and p_amount_cents <> v_charge.amount_cents then
        raise exception 'PENDING_CHARGE_EXISTS' using errcode = 'PT409';
      end if;

      return jsonb_build_object(
        'reissue', true,
        'previous_charge_id', v_charge.id,
        'previous_asaas_payment_id', v_charge.asaas_payment_id,
        'charge_id', v_charge.id,
        'amount_cents', v_charge.amount_cents,
        'status', v_charge.status,
        'asaas_payment_id', v_charge.asaas_payment_id,
        'pix_qr_code', null,
        'pix_copy_paste', null,
        'expires_at', v_charge.expires_at,
        'reused', false,
        'reopened', false,
        'requested_amount_mismatch', false
      );
    end if;

    if v_attempt = 2 then
      raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
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

    if v_charge.id is not null then
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
        'reissue', false,
        'requested_amount_mismatch', false
      );
    end if;
  end loop;

  raise exception 'CHARGE_NOT_PENDING' using errcode = 'PT409';
end;
$$;

-- ============================================================================
-- 4) attach_charge_gateway_data — fencing: só grava com o token do claim.
--    Assinatura anterior (com p_actor_id) é removida para não deixar overload vivo.
-- ============================================================================
drop function if exists public.attach_charge_gateway_data(uuid, uuid, uuid, text, text, text);

create or replace function public.attach_charge_gateway_data(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_claim_token timestamptz,
  p_asaas_payment_id text,
  p_pix_qr_code text,
  p_pix_copy_paste text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_charge public.charges%rowtype;
begin
  if p_tenant_id is null or p_charge_id is null or p_claim_token is null
     or p_asaas_payment_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- O UPDATE é o fence: o criador expirado não sobrescreve quem reivindicou depois.
  update public.charges
     set asaas_payment_id = p_asaas_payment_id,
         pix_qr_code = p_pix_qr_code,
         pix_copy_paste = p_pix_copy_paste,
         expires_at = coalesce(p_expires_at, expires_at),
         gateway_claimed_at = null,
         gateway_claim_expires_at = null
   where tenant_id = p_tenant_id
     and id = p_charge_id
     and status = 'pendente'
     and gateway_claimed_at = p_claim_token
     and gateway_claim_expires_at > now()
   returning * into v_charge;

  if v_charge.id is null then
    raise exception 'GATEWAY_CLAIM_LOST' using errcode = 'PT409';
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, null, 'charge_created', 'charge', v_charge.id,
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
-- 5) cancel_charge — limpa o claim na transição.
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
-- 6) release_charge_reservation — libera a reserva local após falha de gateway.
--    Aceita admin/recepção e profissional DONO. Só cancela reserva ainda sem
--    `asaas_payment_id`; libera o claim na mesma transição.
--    Fence: claim vivo de OUTRO criador (token diferente do caller) => PT409.
-- ============================================================================
drop function if exists public.release_charge_reservation(uuid, uuid, uuid);

create or replace function public.release_charge_reservation(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_actor_id uuid,
  p_claim_token timestamptz default null
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

  -- Fence: claim vivo de OUTRO criador não pode ser liberado por este caller.
  -- Sem token (ou token de outro) e claim vivo => o dono ainda pode anexar.
  if v_charge.gateway_claimed_at is not null
     and v_charge.gateway_claim_expires_at is not null
     and v_charge.gateway_claim_expires_at > now()
     and v_charge.gateway_claimed_at is distinct from p_claim_token then
    raise exception 'GATEWAY_IN_PROGRESS' using errcode = 'PT409';
  end if;

  -- Só a reserva pura (pendente e sem gateway) é liberável; pago nunca é tocado.
  if v_charge.status = 'pendente' and v_charge.asaas_payment_id is null then
    update public.charges
       set status = 'cancelado',
           gateway_claimed_at = null,
           gateway_claim_expires_at = null
     where tenant_id = p_tenant_id
       and id = p_charge_id
       and status = 'pendente'
       and asaas_payment_id is null
     returning * into v_charge;

    if v_charge.id is null then
      return jsonb_build_object(
        'released', false,
        'charge_id', p_charge_id,
        'charge_status', 'pendente'
      );
    end if;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, p_actor_id, 'charge_reservation_released', 'charge', v_charge.id,
      jsonb_build_object(
        'appointment_id', v_charge.appointment_id,
        'charge_id', v_charge.id,
        'amount_cents', v_charge.amount_cents
      )
    );

    return jsonb_build_object(
      'released', true,
      'charge_id', v_charge.id,
      'charge_status', v_charge.status
    );
  end if;

  return jsonb_build_object(
    'released', false,
    'charge_id', v_charge.id,
    'charge_status', v_charge.status
  );
end;
$$;

-- ============================================================================
-- 7) register_appointment_payments — colisão de chave em charges ANTES do lote.
--    A função é re-declarada integralmente para manter a idempotência atômica.
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

  -- 7b) Colisão de idempotency_key em charges de OUTRO atendimento:
  --     falha antes de qualquer INSERT (nada é escrito).
  if exists (
    select 1 from public.charges c
     where c.tenant_id = p_tenant_id
       and c.idempotency_key = p_idempotency_key
       and c.appointment_id is distinct from p_appointment_id
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
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
-- 8) Grants e comentários (idempotentes).
-- ============================================================================
revoke execute on function public.claim_charge_gateway(uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function public.claim_charge_gateway(uuid, uuid, int)
  to service_role;

revoke execute on function public.reopen_charge_for_reissue(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reopen_charge_for_reissue(uuid, uuid, timestamptz)
  to service_role;

revoke execute on function public.reserve_appointment_charge(uuid, uuid, uuid, int, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_appointment_charge(uuid, uuid, uuid, int, uuid, timestamptz)
  to service_role;

revoke execute on function public.attach_charge_gateway_data(uuid, uuid, timestamptz, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.attach_charge_gateway_data(uuid, uuid, timestamptz, text, text, text, timestamptz)
  to service_role;

revoke execute on function public.cancel_charge(uuid, uuid, uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.cancel_charge(uuid, uuid, uuid, boolean, boolean)
  to service_role;

revoke execute on function public.release_charge_reservation(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_charge_reservation(uuid, uuid, uuid, timestamptz)
  to service_role;

revoke execute on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean)
  to service_role;

comment on function public.claim_charge_gateway(uuid, uuid, int) is
  'ADR-002: claim atômico de criação no gateway; devolve o token (gateway_claimed_at).';
comment on function public.attach_charge_gateway_data(uuid, uuid, timestamptz, text, text, text, timestamptz) is
  'ADR-002: fencing — só grava se o token do claim ainda é o dono e não expirou.';
comment on function public.release_charge_reservation(uuid, uuid, uuid, timestamptz) is
  'ADR-002: libera a reserva local (pendente, sem gateway) e o claim; recusa claim vivo de outro criador; pago nunca.';
comment on function public.reopen_charge_for_reissue(uuid, uuid, timestamptz) is
  'ADR-002: reabre cobrança expirada/cancelada para novo QR na MESMA linha; pago nunca.';
