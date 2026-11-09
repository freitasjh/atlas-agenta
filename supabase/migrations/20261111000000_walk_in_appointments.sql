-- ============================================================================
-- PDV balcão (walk-in) — ADR-21: origin + customer nullable + idempotência de
-- criação + RPC `create_walk_in_appointment`.
--
-- Modelo 1R (analysis-data §4): `appointments.origin` ('agendado'|'walk_in')
-- ortogonal ao `status` (6 valores, inalterados) + `customer_id` nullable com
-- CHECK `agendado exige cliente, walk_in pode ser anônimo`. Sem novo status,
-- sem entidade sales, sem segundo financeiro. `origin` não entra em
-- trigger/máquina/RLS/relatório — só filtra UI ("vendas de balcão") e autoriza
-- `customer_id NULL`. A venda nasce `em_atendimento` e conclui via UPDATE de
-- `register_appointment_payments` (dispara comissão no trigger); inserir
-- `concluido` direto é proibido por regra de negócio (não gera comissão).
--
-- Aditiva e idempotente (`add column if not exists`, check de constraint via
-- `pg_constraint`, `create index if not exists`, `create or replace`). Não
-- toca ledger/charges/commissions/guards. Nenhum segredo no SQL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. `origin` — default 'agendado' preserva backfill (nunca null).
-- ----------------------------------------------------------------------------
alter table public.appointments
  add column if not exists origin text not null default 'agendado'
    check (origin in ('agendado', 'walk_in'));

-- ----------------------------------------------------------------------------
-- 2. `customer_id` nullable — FK composta MATCH SIMPLE: null não é checada
--    (mesmo regime de `service_id`/`combo_id` do XOR).
-- ----------------------------------------------------------------------------
alter table public.appointments
  alter column customer_id drop not null;

-- ----------------------------------------------------------------------------
-- 3. CHECK de exactly-one-of para cliente (bloco pg_constraint do repo):
--    agendado exige cliente; walk_in pode ser anônimo.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_walk_in_customer_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_walk_in_customer_check check (
        (origin = 'agendado' and customer_id is not null)
        or (origin = 'walk_in')
      );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. Idempotência de criação (duplo clique / retry). O lote de pagamento já
--    é idempotente; o INSERT não tinha chave. O chamador gera um UUID por
--    clique de "Registrar venda" e reusa em retry; mesma chave devolve o
--    existente em vez de inserir de novo.
-- ----------------------------------------------------------------------------
alter table public.appointments
  add column if not exists creation_idempotency_key uuid;

create unique index if not exists appointments_tenant_creation_idem_idx
  on public.appointments (tenant_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

-- ----------------------------------------------------------------------------
-- 5. Índice parcial de vendas de balcão (lista do PDV + filtro "só balcão").
-- ----------------------------------------------------------------------------
create index if not exists appointments_tenant_origin_starts_idx
  on public.appointments (tenant_id, origin, starts_at)
  where origin = 'walk_in';

-- ----------------------------------------------------------------------------
-- 6. RPC `create_walk_in_appointment` (security invoker, execute só
--    service_role — ao lado de `register_appointment_payments`).
--    2 chamadas (create + register): a janela "venda aberta" é estado de
--    domínio válido (`sem_pagamento`/`parcial`). Preço/origem/nascimento do
--    servidor; `tenant_id`/`actor_id` vêm da identidade do servidor, nunca do
--    payload. Erros PT4xx no vocabulário dos RPCs de pagamento.
-- ----------------------------------------------------------------------------
create or replace function public.create_walk_in_appointment(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_professional_id uuid,
  p_service_id uuid default null,
  p_combo_id uuid default null,
  p_customer_id uuid default null,
  p_creation_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $create_walk_in_appointment$
declare
  v_actor_role text;
  v_professional_active boolean;
  v_professional_profile uuid;
  v_service_duration int;
  v_service_price int;
  v_combo_price int;
  v_combo_duration int;
  v_price_cents int;
  v_duration int;
  v_existing uuid;
  v_new_id uuid;
  v_starts_at timestamptz := now();
  v_ends_at timestamptz;
begin
  if p_tenant_id is null or p_actor_id is null or p_professional_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- XOR: exatamente um de service/combo (mesmo invariante do CHECK de coluna).
  if (p_service_id is null) = (p_combo_id is null) then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Ator ativo no tenant, papel operacional.
  select role into v_actor_role
  from public.profiles
  where id = p_actor_id and tenant_id = p_tenant_id and active = true
  limit 1;
  if v_actor_role is null or v_actor_role not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  -- Profissional ativo do tenant; professional só para si (dono comprovado).
  select active, profile_id into v_professional_active, v_professional_profile
  from public.professionals
  where tenant_id = p_tenant_id and id = p_professional_id
  limit 1;
  if v_professional_active is null or v_professional_active = false then
    raise exception 'PROFESSIONAL_NOT_AVAILABLE' using errcode = 'PT404';
  end if;
  if v_actor_role = 'professional' and v_professional_profile is distinct from p_actor_id then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  -- Preço/duração do catálogo vigente (nunca do cliente).
  if p_service_id is not null then
    select price_cents, duration_minutes into v_service_price, v_service_duration
    from public.services
    where tenant_id = p_tenant_id and id = p_service_id and active = true
    limit 1;
    if v_service_price is null then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
    end if;
    v_price_cents := v_service_price;
    v_duration := v_service_duration;
  else
    select price_cents into v_combo_price
    from public.combos
    where tenant_id = p_tenant_id and id = p_combo_id and active = true
    limit 1;
    if v_combo_price is null then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
    end if;
    select coalesce(sum(s.duration_minutes), 0) into v_combo_duration
    from public.combo_services cs
    join public.services s
      on s.tenant_id = cs.tenant_id and s.id = cs.service_id
    where cs.tenant_id = p_tenant_id and cs.combo_id = p_combo_id;
    v_price_cents := v_combo_price;
    v_duration := v_combo_duration;
  end if;

  -- Cliente identificado opcional: quando presente, é do tenant.
  if p_customer_id is not null then
    if not exists (
      select 1 from public.customers
      where tenant_id = p_tenant_id and id = p_customer_id
      limit 1
    ) then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
    end if;
  end if;

  v_ends_at := v_starts_at + make_interval(mins => v_duration);

  -- Idempotência de criação: mesma chave devolve o existente.
  if p_creation_idempotency_key is not null then
    select id into v_existing
    from public.appointments
    where tenant_id = p_tenant_id
      and creation_idempotency_key = p_creation_idempotency_key
      and origin = 'walk_in'
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('id', v_existing, 'reused', true);
    end if;
  end if;

  insert into public.appointments (
    tenant_id, origin, customer_id, professional_id,
    service_id, combo_id, starts_at, ends_at, price_cents,
    status, creation_idempotency_key
  ) values (
    p_tenant_id, 'walk_in', p_customer_id, p_professional_id,
    p_service_id, p_combo_id, v_starts_at, v_ends_at, v_price_cents,
    'em_atendimento', p_creation_idempotency_key
  )
  returning id into v_new_id;

  -- Audit sem PII (ids + origem; nunca telefone).
  insert into public.audit_log (
    tenant_id, actor_id, action, target_type, target_id, metadata
  ) values (
    p_tenant_id, p_actor_id, 'walk_in_created', 'appointment', v_new_id,
    jsonb_build_object('origin', 'walk_in', 'service_id', p_service_id, 'combo_id', p_combo_id)
  );

  return jsonb_build_object('id', v_new_id, 'reused', false);
end
$create_walk_in_appointment$;

revoke all on function public.create_walk_in_appointment(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  from anon, authenticated;
grant execute on function public.create_walk_in_appointment(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  to service_role;
