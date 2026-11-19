-- Migration: cupons e gift cards (ADR-07 Fase 4) — backend + aplicação no PDV.
-- Escopo: tabelas `coupons`, `gift_cards`, `gift_card_redemptions`,
-- `coupon_redemptions` + RLS/RBAC + RPCs de validação/aplicação/resgate +
-- resumo de fechamento coupon-aware + método `gift_card` no ledger.
-- Não entra: UI (ADR-15), pontos de fidelidade (ADR-06), relatórios, Edge nova.
--
-- Decisões (PRD §10 perguntas 1-2, ADR-07 §Contexto):
--   Q1 cupom vs desconto: cupom reduz o TOTAL A PAGAR ANTES do registro no
--     ledger. Não há linha de desconto no `appointment_payments` (fonte única
--     de receita, sem poluição); o efeito vive em `coupon_redemptions`
--     (discount_cents auditável) e o `appointment_payment_summary` passa a
--     expor `discount_cents`/`total_final_cents`, com `remaining`/`payment_status`
--     calculados sobre o total final. `register_appointment_payments` valida o
--     teto contra o total final (price - desconto) em vez do preço cheio.
--   Q2 gift card como forma: gift card É FORMA DE PAGAMENTO `gift_card` no
--     ledger (novo valor no check de `method`), com linha real em
--     `appointment_payments` (receita reconhecida NO RESGATE, quando o serviço
--     é prestado). Saldo parcial permitido: um resgate consome parte do saldo;
--     o restante segue disponível. Sem dupla contagem por desenho:
--     a EMISSÃO do gift card não cria linha no ledger (é passivo/saldo, fora do
--     MVP contábil); só o resgate vira receita.
--   Contábil MVP (ADR-07 §Consequências): venda de gift card = receita
--     antecipada não registrada no ledger; resgate = receita via linha
--     `gift_card`. Evita dupla contagem sem ledger de passivo.
--
-- Regras (PRD §6.4 RF-19/RF-20/RF-21/RF-22/RF-23):
--   - Cupom: código único por tenant, tipo percent|fixed, validade
--     (valid_from/until), limite de uso (usage_limit/used_count com lock),
--     segmento jsonb, flag active. Um cupom por fechamento
--     (unique (tenant, appointment) em coupon_redemptions).
--   - Gift card: código único por tenant, initial/balance cents, validade,
--     status active|exhausted|expired|cancelled. Resgate parcial com lock.
--   - Segmento do cupom: {"service_ids": [uuid...], "min_price_cents": N};
--     segmento nulo/vazio {} = toda a base (mesma convenção de campanhas).
--   - Percentual usa floor (mesma convenção de pontos da ADR-06); fixo sofre
--     teto no preço (least(value, price)).
--   - Expiração: validação rejeita fora da janela; sweep marca gift cards
--     vencidos como expired (cupom não precisa de carimbo: a janela decide).
--   - RBAC: admin emite (insert/update em coupons/gift_cards); staff
--     (admin/receptionist/professional) lê para validar no PDV; aplicação via
--     RPCs por admin/receptionist/professional (professional só no próprio
--     atendimento, mesma regra do register).
--   - Gating: toda RPC exige entitlement `fidelidade` (tenant_has_feature,
--     mesma decisão da ADR-06: RLS não depende de entitlement; sem entitlement
--     a rota some e a RPC nega com FEATURE_DISABLED).
--
-- Concorrência: cupom e gift card travados com FOR UPDATE; crédito de uso com
-- lock; resgate idempotente por idempotency_key (replay sinalizado) e por
-- (gift_card, appointment). RPCs SECURITY DEFINER (escrevem ledger/audit_log,
-- sem policy de escrita p/ authenticated) com tenant derivado do JWT ou da
-- linha do appointment + gate de papel explícito (PT403). search_path fixo.
-- Idempotente (if not exists / or replace / drop policy if exists).
-- Dinheiro em centavos inteiros; tempo em timestamptz (UTC).

-- ============================================================================
-- 1. coupons — cupom promocional por tenant.
-- ============================================================================
create table if not exists public.coupons (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  code            text not null check (char_length(btrim(code)) between 1 and 64),
  type            text not null check (type in ('percent','fixed')),
  value           int not null check (value > 0),
  valid_from      timestamptz,
  valid_until     timestamptz,
  usage_limit     int check (usage_limit is null or usage_limit > 0),
  used_count      int not null default 0 check (used_count >= 0),
  segment         jsonb,
  active          boolean not null default true,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint coupons_tenant_code_unique unique (tenant_id, code),
  constraint coupons_tenant_id_unique unique (tenant_id, id),
  constraint coupons_percent_range check (
    type <> 'percent' or value <= 100
  ),
  constraint coupons_validity_window check (
    valid_from is null or valid_until is null or valid_until > valid_from
  )
);

create index if not exists coupons_tenant_id_idx
  on public.coupons (tenant_id);
create index if not exists coupons_tenant_active_idx
  on public.coupons (tenant_id, active)
  where active = true;

alter table public.coupons enable row level security;

-- Leitura: todo papel operacional (PDV precisa validar).
drop policy if exists coupons_select_staff on public.coupons;
create policy coupons_select_staff on public.coupons for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );

-- Escrita: só admin (emissão/gestão). Sem DELETE físico pela app.
drop policy if exists coupons_write_admin on public.coupons;
create policy coupons_write_admin on public.coupons for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

create or replace function public.coupons_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists coupons_no_hard_delete on public.coupons;
create trigger coupons_no_hard_delete
  before delete on public.coupons
  for each row execute function public.coupons_no_hard_delete();

-- ============================================================================
-- 2. gift_cards — cartão presente com saldo por tenant.
-- ============================================================================
create table if not exists public.gift_cards (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  code                  text not null check (char_length(btrim(code)) between 1 and 64),
  initial_value_cents   int not null check (initial_value_cents > 0),
  balance_cents         int not null check (balance_cents >= 0),
  valid_until           timestamptz,
  status                text not null default 'active'
    check (status in ('active','exhausted','expired','cancelled')),
  issued_by             uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint gift_cards_tenant_code_unique unique (tenant_id, code),
  constraint gift_cards_tenant_id_unique unique (tenant_id, id),
  constraint gift_cards_balance_cap check (balance_cents <= initial_value_cents)
);

create index if not exists gift_cards_tenant_id_idx
  on public.gift_cards (tenant_id);
create index if not exists gift_cards_tenant_status_idx
  on public.gift_cards (tenant_id, status);

alter table public.gift_cards enable row level security;

drop policy if exists gift_cards_select_staff on public.gift_cards;
create policy gift_cards_select_staff on public.gift_cards for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );

drop policy if exists gift_cards_write_admin on public.gift_cards;
create policy gift_cards_write_admin on public.gift_cards for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

create or replace function public.gift_cards_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists gift_cards_no_hard_delete on public.gift_cards;
create trigger gift_cards_no_hard_delete
  before delete on public.gift_cards
  for each row execute function public.gift_cards_no_hard_delete();

-- ============================================================================
-- 3. coupon_redemptions — uso de cupom no fechamento (um por atendimento).
-- ============================================================================
create table if not exists public.coupon_redemptions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  coupon_id        uuid not null,
  appointment_id   uuid not null,
  discount_cents   int not null check (discount_cents >= 0),
  idempotency_key  uuid,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint coupon_redemptions_coupon_fk
    foreign key (tenant_id, coupon_id)
    references public.coupons (tenant_id, id) on delete restrict,
  constraint coupon_redemptions_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint coupon_redemptions_tenant_id_unique unique (tenant_id, id),
  -- Um cupom por fechamento (decisão PDV: desconto único e auditável).
  constraint coupon_redemptions_one_per_closing unique (tenant_id, appointment_id)
);

create unique index if not exists coupon_redemptions_idem_uidx
  on public.coupon_redemptions (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists coupon_redemptions_tenant_coupon_idx
  on public.coupon_redemptions (tenant_id, coupon_id);

alter table public.coupon_redemptions enable row level security;

-- Leitura: admin/recepção; professional só do próprio atendimento.
drop policy if exists coupon_redemptions_select_staff on public.coupon_redemptions;
create policy coupon_redemptions_select_staff on public.coupon_redemptions for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() in ('admin','receptionist')
      or (
        current_role_name() = 'professional'
        and exists (
          select 1 from public.appointments a
          join public.professionals p
            on p.tenant_id = a.tenant_id
           and p.id = a.professional_id
         where a.tenant_id = coupon_redemptions.tenant_id
           and a.id = coupon_redemptions.appointment_id
           and p.profile_id = auth.uid()
        )
      )
    )
  );

-- Sem policy de escrita: só via RPC (auditoria). Direct write nega por RLS.
create or replace function public.coupon_redemptions_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists coupon_redemptions_no_hard_delete on public.coupon_redemptions;
create trigger coupon_redemptions_no_hard_delete
  before delete on public.coupon_redemptions
  for each row execute function public.coupon_redemptions_no_hard_delete();

-- Alvo de FK composta por tenant para a trilha de resgate
-- (mesmo padrão do §2.1 do ledger para charges).
create unique index if not exists appointment_payments_tenant_id_id_appointment_uidx
  on public.appointment_payments (tenant_id, id, appointment_id);

-- ============================================================================
-- 4. gift_card_redemptions — abate de saldo no fechamento (trilha).
-- ============================================================================
create table if not exists public.gift_card_redemptions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  gift_card_id           uuid not null,
  appointment_id         uuid not null,
  appointment_payment_id uuid,
  amount_cents           int not null check (amount_cents > 0),
  idempotency_key        uuid,
  created_at             timestamptz not null default now(),
  constraint gift_card_redemptions_card_fk
    foreign key (tenant_id, gift_card_id)
    references public.gift_cards (tenant_id, id) on delete restrict,
  constraint gift_card_redemptions_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint gift_card_redemptions_payment_fk
    foreign key (tenant_id, appointment_payment_id, appointment_id)
    references public.appointment_payments (tenant_id, id, appointment_id)
    on delete restrict,
  constraint gift_card_redemptions_tenant_id_unique unique (tenant_id, id),
  -- Um resgate por cartão/fechamento (parcial = um abate; replay idempotente).
  constraint gift_card_redemptions_one_per_card_closing
    unique (tenant_id, gift_card_id, appointment_id)
);

create unique index if not exists gift_card_redemptions_idem_uidx
  on public.gift_card_redemptions (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists gift_card_redemptions_tenant_card_idx
  on public.gift_card_redemptions (tenant_id, gift_card_id);

alter table public.gift_card_redemptions enable row level security;

drop policy if exists gift_card_redemptions_select_staff on public.gift_card_redemptions;
create policy gift_card_redemptions_select_staff on public.gift_card_redemptions for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() in ('admin','receptionist')
      or (
        current_role_name() = 'professional'
        and exists (
          select 1 from public.appointments a
          join public.professionals p
            on p.tenant_id = a.tenant_id
           and p.id = a.professional_id
         where a.tenant_id = gift_card_redemptions.tenant_id
           and a.id = gift_card_redemptions.appointment_id
           and p.profile_id = auth.uid()
        )
      )
    )
  );

create or replace function public.gift_card_redemptions_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists gift_card_redemptions_no_hard_delete on public.gift_card_redemptions;
create trigger gift_card_redemptions_no_hard_delete
  before delete on public.gift_card_redemptions
  for each row execute function public.gift_card_redemptions_no_hard_delete();

-- ============================================================================
-- 5. Ledger: novo método `gift_card` (Q2: forma de pagamento, receita no resgate).
-- ============================================================================
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointment_payments'::regclass
       and conname = 'appointment_payments_method_check'
  ) then
    alter table public.appointment_payments
      drop constraint appointment_payments_method_check;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointment_payments'::regclass
       and conname = 'appointment_payments_method_check'
  ) then
    alter table public.appointment_payments
      add constraint appointment_payments_method_check
      check (method in (
        'dinheiro','cartao_credito','cartao_debito',
        'pix_sistema','pix_maquininha','gift_card'
      ));
  end if;
end;
$$;

-- ============================================================================
-- 6. Cálculo de desconto (interno, sem grants: só RPCs chamam).
-- ============================================================================
create or replace function public.coupon_compute_discount(
  p_type text,
  p_value int,
  p_price_cents int
)
returns int
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_price_cents is null or p_price_cents <= 0 then
    return 0;
  end if;
  if p_type = 'percent' then
    return floor((p_price_cents::numeric * p_value::numeric / 100.0))::int;
  end if;
  return least(p_value, p_price_cents);
end;
$$;

revoke all on function public.coupon_compute_discount(text, int, int)
  from public, anon, authenticated;

-- Segmento do cupom: {"service_ids": [uuid...], "min_price_cents": N}.
-- Nulo/vazio = toda a base (convenção de campanhas).
create or replace function public.coupon_segment_matches(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_segment jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_service uuid;
  v_price int;
  v_ids uuid[] := '{}';
  v_min int := 0;
begin
  if p_segment is null or p_segment = '{}'::jsonb then
    return true;
  end if;

  select a.service_id, a.price_cents into v_service, v_price
    from public.appointments a
   where a.tenant_id = p_tenant_id
     and a.id = p_appointment_id;
  if not found then
    return false;
  end if;

  if p_segment ? 'service_ids'
     and jsonb_typeof(p_segment->'service_ids') = 'array'
     and jsonb_array_length(p_segment->'service_ids') > 0 then
    select coalesce(array_agg((t)::uuid), '{}') into v_ids
      from jsonb_array_elements_text(p_segment->'service_ids') t;
    if not (v_service = any (v_ids)) then
      return false;
    end if;
  end if;

  v_min := coalesce(nullif(p_segment->>'min_price_cents', '')::int, 0);
  if v_min > 0 and coalesce(v_price, 0) < v_min then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.coupon_segment_matches(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ============================================================================
-- 7. appointment_payment_summary passa a ser coupon-aware (Q1).
-- Mesma assinatura; chaves novas `discount_cents`/`total_final_cents`
-- (aditivas); `remaining`/`payment_status` sobre o total final.
-- Sem cupom aplicado o resultado é idêntico ao anterior (discount 0).
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
  discount as (
    select coalesce(sum(cr.discount_cents), 0)::int as discount_cents
      from public.coupon_redemptions cr
     where cr.tenant_id = p_tenant_id
       and cr.appointment_id = p_appointment_id
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
      'discount_cents', d.discount_cents,
      'total_final_cents', greatest(a.price_cents - d.discount_cents, 0),
      'total_paid_cents', p.paid_cents,
      'tip_cents', p.tip_cents,
      'reserved_cents', coalesce((select amount_cents from pending), 0),
      'remaining_cents', greatest(
        greatest(a.price_cents - d.discount_cents, 0)
          - p.paid_cents
          - coalesce((select amount_cents from pending), 0),
        0
      ),
      'payment_status', case
        when greatest(a.price_cents - d.discount_cents, 0) = 0 and p.paid_cents = 0 then 'quitado'
        when p.paid_cents >= greatest(a.price_cents - d.discount_cents, 0) then 'quitado'
        when exists (select 1 from pending) then 'aguardando_pix'
        when p.paid_cents = 0 then 'sem_pagamento'
        else 'parcial'
      end,
      'pending_charge_id', (select id from pending),
      'pending_charge_amount_cents', coalesce((select amount_cents from pending), 0)
    )
  end
    from appt a
    cross join discount d
    cross join paid p;
$$;

-- ============================================================================
-- 8. register_appointment_payments: teto contra o total final + `gift_card`.
-- OR REPLACE idêntico ao vigente da 20261118090100 (guarda §8a + §7b) salvo: (a) `gift_card` entra no whitelist de
-- methods (cai no balde manual, como dinheiro); (b) guarda de teto usa
-- price - desconto do fechamento. Sem cupom o comportamento é idêntico.
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
  v_discount          int;
  v_effective         int;
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
      'dinheiro', 'cartao_credito', 'cartao_debito', 'pix_sistema', 'pix_maquininha',
      'gift_card'
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

  if jsonb_array_length(p_payments) = 0 and p_close_appointment is not true then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

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

  if v_appt.status not in ('em_atendimento', 'concluido') then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;

  if v_appt.status = 'em_atendimento' and p_close_appointment is not true then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;

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

  -- 7b) Colisao de idempotency_key em charges de OUTRO atendimento:
  --     falha antes de qualquer INSERT (nada e escrito).
  if exists (
    select 1 from public.charges c
     where c.tenant_id = p_tenant_id
       and c.idempotency_key = p_idempotency_key
       and c.appointment_id is distinct from p_appointment_id
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
  end if;

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

  if v_appt.status = 'concluido' and p_close_appointment is true then
    raise exception 'APPOINTMENT_ALREADY_CONCLUDED' using errcode = 'PT409';
  end if;

  -- 8a) Pacote valido recusa lote com pagamento (anti-dupla-cobranca).
  --     Lote vazio + close=true e o caminho do pacote (o trigger consome no
  --     concluir) e segue permitido; replay ja retornou acima sem escrever.
  if jsonb_array_length(p_payments) > 0
     and v_appt.customer_id is not null
     and v_appt.service_id is not null
     and exists (
       select 1 from public.package_credits c
        where c.tenant_id = p_tenant_id
          and c.customer_id = v_appt.customer_id
          and c.service_id = v_appt.service_id
          and c.status = 'active'
          and c.expires_at > now()
          and c.used_sessions < c.total_sessions
     ) then
    raise exception 'PACKAGE_CREDIT_AVAILABLE' using errcode = 'PT409';
  end if;

  if v_pix_count = 1 and v_has_pending and v_pending.amount_cents <> v_pix_intent then
    raise exception 'PENDING_CHARGE_EXISTS' using errcode = 'PT409';
  end if;
  if v_pix_count = 1 and not v_has_pending then
    v_pix_for_balance := v_pix_intent;
  end if;

  -- Teto contra o TOTAL FINAL (preço menos cupom do fechamento, Q1).
  v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
  v_price := coalesce((v_summary ->> 'price_cents')::int, 0);
  v_discount := coalesce((v_summary ->> 'discount_cents')::int, 0);
  v_effective := greatest(v_price - v_discount, 0);
  v_paid := coalesce((v_summary ->> 'total_paid_cents')::int, 0);
  v_reserved := coalesce((v_summary ->> 'reserved_cents')::int, 0);

  if v_paid + v_reserved + v_manual_sum + v_pix_for_balance > v_effective then
    raise exception 'AMOUNT_EXCEEDS_REMAINING' using errcode = 'PT409';
  end if;

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
-- 9. RPCs públicas de cupom/gift card.
-- ============================================================================

-- Validação de cupom (somente leitura; PDV consulta antes de aplicar).
create or replace function public.coupon_validate(
  p_appointment_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_appt public.appointments%rowtype;
  v_coupon public.coupons%rowtype;
  v_discount int;
begin
  if v_role not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_appointment_id is null or p_code is null or btrim(p_code) = '' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_appt from public.appointments
   where tenant_id = v_tenant and id = p_appointment_id;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if not public.tenant_has_feature(v_tenant, 'fidelidade') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;
  if v_role = 'professional'
     and not exists (
       select 1 from public.professionals p
        where p.tenant_id = v_tenant
          and p.id = v_appt.professional_id
          and p.profile_id = auth.uid()
     ) then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  select * into v_coupon from public.coupons
   where tenant_id = v_tenant and code = p_code;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'COUPON_NOT_FOUND');
  end if;
  if not v_coupon.active then
    return jsonb_build_object('valid', false, 'reason', 'COUPON_INACTIVE');
  end if;
  if v_coupon.valid_from is not null and v_coupon.valid_from > now() then
    return jsonb_build_object('valid', false, 'reason', 'COUPON_NOT_STARTED');
  end if;
  if v_coupon.valid_until is not null and v_coupon.valid_until < now() then
    return jsonb_build_object('valid', false, 'reason', 'COUPON_EXPIRED');
  end if;
  if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
    return jsonb_build_object('valid', false, 'reason', 'COUPON_LIMIT_REACHED');
  end if;
  if not public.coupon_segment_matches(v_tenant, p_appointment_id, v_coupon.segment) then
    return jsonb_build_object('valid', false, 'reason', 'COUPON_SEGMENT_MISMATCH');
  end if;

  v_discount := public.coupon_compute_discount(v_coupon.type, v_coupon.value, v_appt.price_cents);
  if v_discount <= 0 then
    return jsonb_build_object('valid', false, 'reason', 'COUPON_NOT_APPLICABLE');
  end if;

  return jsonb_build_object(
    'valid', true,
    'coupon_id', v_coupon.id,
    'discount_cents', v_discount,
    'total_final_cents', greatest(v_appt.price_cents - v_discount, 0)
  );
end;
$$;

-- Aplicação de cupom no fechamento (registra uso; um cupom por atendimento).
create or replace function public.apply_coupon_to_closing(
  p_appointment_id uuid,
  p_code text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_appt public.appointments%rowtype;
  v_coupon public.coupons%rowtype;
  v_existing public.coupon_redemptions%rowtype;
  v_discount int;
  v_total int;
begin
  if v_actor is not null and v_role not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_appointment_id is null or p_code is null or btrim(p_code) = ''
     or p_idempotency_key is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Replay pela chave (mesma via service_role ou staff).
  if v_actor is null then
    select * into v_existing from public.coupon_redemptions
     where idempotency_key = p_idempotency_key;
  else
    select * into v_existing from public.coupon_redemptions
     where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
  end if;
  if found then
    return jsonb_build_object(
      'appointment_id', v_existing.appointment_id,
      'coupon_id', v_existing.coupon_id,
      'discount_cents', v_existing.discount_cents,
      'applied', true, 'replayed', true
    );
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_actor is not null and v_appt.tenant_id <> v_tenant then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  v_tenant := v_appt.tenant_id;
  if v_appt.status not in ('em_atendimento','concluido') then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;
  if not public.tenant_has_feature(v_tenant, 'fidelidade') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;
  if v_actor is not null and v_role = 'professional'
     and not exists (
       select 1 from public.professionals p
        where p.tenant_id = v_tenant
          and p.id = v_appt.professional_id
          and p.profile_id = v_actor
     ) then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  if exists (
    select 1 from public.coupon_redemptions
     where tenant_id = v_tenant and appointment_id = p_appointment_id
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
  end if;

  select * into v_coupon from public.coupons
   where tenant_id = v_tenant and code = p_code
   for update;
  if not found then
    raise exception 'COUPON_NOT_FOUND' using errcode = 'PT404';
  end if;
  if not v_coupon.active then
    raise exception 'COUPON_INACTIVE' using errcode = 'PT409';
  end if;
  if v_coupon.valid_from is not null and v_coupon.valid_from > now() then
    raise exception 'COUPON_NOT_STARTED' using errcode = 'PT409';
  end if;
  if v_coupon.valid_until is not null and v_coupon.valid_until < now() then
    raise exception 'COUPON_EXPIRED' using errcode = 'PT409';
  end if;
  if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
    raise exception 'COUPON_LIMIT_REACHED' using errcode = 'PT409';
  end if;
  if not public.coupon_segment_matches(v_tenant, p_appointment_id, v_coupon.segment) then
    raise exception 'COUPON_SEGMENT_MISMATCH' using errcode = 'PT409';
  end if;

  v_discount := public.coupon_compute_discount(v_coupon.type, v_coupon.value, v_appt.price_cents);
  if v_discount <= 0 then
    raise exception 'COUPON_NOT_APPLICABLE' using errcode = 'PT409';
  end if;
  v_total := greatest(v_appt.price_cents - v_discount, 0);

  insert into public.coupon_redemptions
    (tenant_id, coupon_id, appointment_id, discount_cents, idempotency_key, created_by)
  values
    (v_tenant, v_coupon.id, p_appointment_id, v_discount, p_idempotency_key, v_actor)
  on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing;

  if not found then
    select * into v_existing from public.coupon_redemptions
     where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'appointment_id', v_existing.appointment_id,
      'coupon_id', v_existing.coupon_id,
      'discount_cents', v_existing.discount_cents,
      'applied', true, 'replayed', true
    );
  end if;

  update public.coupons
     set used_count = used_count + 1, updated_at = now()
   where id = v_coupon.id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (v_tenant, v_actor, 'coupon_applied', 'appointment', p_appointment_id,
          jsonb_build_object('coupon_id', v_coupon.id, 'code', v_coupon.code,
                             'discount_cents', v_discount,
                             'idempotency_key', p_idempotency_key));

  return jsonb_build_object(
    'appointment_id', p_appointment_id,
    'coupon_id', v_coupon.id,
    'discount_cents', v_discount,
    'total_final_cents', v_total,
    'applied', true, 'replayed', false
  );
end;
$$;

-- Validação de gift card (somente leitura; PDV consulta saldo antes de resgatar).
create or replace function public.gift_card_validate(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_card public.gift_cards%rowtype;
begin
  if current_role_name() not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if not public.tenant_has_feature(v_tenant, 'fidelidade') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  select * into v_card from public.gift_cards
   where tenant_id = v_tenant and code = p_code;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'GIFT_CARD_NOT_FOUND');
  end if;
  if v_card.status = 'cancelled' then
    return jsonb_build_object('valid', false, 'reason', 'GIFT_CARD_CANCELLED');
  end if;
  if v_card.status = 'exhausted' or v_card.balance_cents <= 0 then
    return jsonb_build_object('valid', false, 'reason', 'GIFT_CARD_EXHAUSTED');
  end if;
  if v_card.status = 'expired'
     or (v_card.valid_until is not null and v_card.valid_until < now()) then
    return jsonb_build_object('valid', false, 'reason', 'GIFT_CARD_EXPIRED');
  end if;

  return jsonb_build_object(
    'valid', true,
    'gift_card_id', v_card.id,
    'balance_cents', v_card.balance_cents,
    'status', v_card.status
  );
end;
$$;

-- Resgate de gift card no fechamento (abate saldo + linha `gift_card` no ledger).
create or replace function public.redeem_gift_card(
  p_appointment_id uuid,
  p_code text,
  p_amount_cents int,
  p_idempotency_key uuid,
  p_line_index smallint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_appt public.appointments%rowtype;
  v_card public.gift_cards%rowtype;
  v_existing public.gift_card_redemptions%rowtype;
  v_summary jsonb;
  v_remaining int;
  v_payment public.appointment_payments%rowtype;
  v_line smallint := coalesce(p_line_index, 0);
begin
  if v_actor is not null and v_role not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_appointment_id is null or p_code is null or btrim(p_code) = ''
     or p_amount_cents is null or p_amount_cents <= 0
     or p_idempotency_key is null or v_line < 0 or v_line >= 50 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if v_actor is null then
    select * into v_existing from public.gift_card_redemptions
     where idempotency_key = p_idempotency_key;
  else
    select * into v_existing from public.gift_card_redemptions
     where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
  end if;
  if found then
    select * into v_payment from public.appointment_payments
     where id = v_existing.appointment_payment_id;
    return jsonb_build_object(
      'appointment_id', v_existing.appointment_id,
      'gift_card_id', v_existing.gift_card_id,
      'amount_cents', v_existing.amount_cents,
      'payment_id', v_existing.appointment_payment_id,
      'redeemed', true, 'replayed', true
    );
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_actor is not null and v_appt.tenant_id <> v_tenant then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  v_tenant := v_appt.tenant_id;
  if v_appt.status not in ('em_atendimento','concluido') then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;
  if not public.tenant_has_feature(v_tenant, 'fidelidade') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;
  if v_actor is not null and v_role = 'professional'
     and not exists (
       select 1 from public.professionals p
        where p.tenant_id = v_tenant
          and p.id = v_appt.professional_id
          and p.profile_id = v_actor
     ) then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  select * into v_card from public.gift_cards
   where tenant_id = v_tenant and code = p_code
   for update;
  if not found then
    raise exception 'GIFT_CARD_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_card.status = 'cancelled' then
    raise exception 'GIFT_CARD_CANCELLED' using errcode = 'PT409';
  end if;
  if v_card.status = 'expired'
     or (v_card.valid_until is not null and v_card.valid_until < now()) then
    raise exception 'GIFT_CARD_EXPIRED' using errcode = 'PT409';
  end if;
  if v_card.status = 'exhausted' or v_card.balance_cents <= 0 then
    raise exception 'GIFT_CARD_EXHAUSTED' using errcode = 'PT409';
  end if;
  if p_amount_cents > v_card.balance_cents then
    raise exception 'GIFT_CARD_INSUFFICIENT' using errcode = 'PT409';
  end if;

  -- Saldo do fechamento SOBRE O TOTAL FINAL (Q1: cupom já aplicado abate aqui).
  v_summary := public.appointment_payment_summary(v_tenant, p_appointment_id);
  v_remaining := coalesce((v_summary ->> 'remaining_cents')::int, 0);
  if p_amount_cents > v_remaining then
    raise exception 'AMOUNT_EXCEEDS_REMAINING' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from public.appointment_payments p
     where p.tenant_id = v_tenant
       and p.idempotency_key = p_idempotency_key
       and p.appointment_id <> p_appointment_id
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
  end if;

  update public.gift_cards
     set balance_cents = balance_cents - p_amount_cents,
         status = case
           when balance_cents - p_amount_cents = 0 then 'exhausted'
           else status
         end,
         updated_at = now()
   where id = v_card.id;

  insert into public.appointment_payments (
    tenant_id, appointment_id, method, amount_cents, tip_cents, source,
    idempotency_key, line_index, received_at, received_by
  )
  values (
    v_tenant, p_appointment_id, 'gift_card', p_amount_cents, 0, 'manual',
    p_idempotency_key, v_line, now(), v_actor
  )
  on conflict (tenant_id, idempotency_key, line_index)
    where idempotency_key is not null do nothing
  returning * into v_payment;

  if v_payment.id is null then
    select * into v_payment from public.appointment_payments p
     where p.tenant_id = v_tenant
       and p.idempotency_key = p_idempotency_key
       and p.line_index = v_line;
    if not found or v_payment.appointment_id <> p_appointment_id then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
    end if;
    -- Corrida: linha já existia com a mesma chave; registra a trilha e retorna.
    insert into public.gift_card_redemptions
      (tenant_id, gift_card_id, appointment_id, appointment_payment_id,
       amount_cents, idempotency_key)
    values
      (v_tenant, v_card.id, p_appointment_id, v_payment.id,
       p_amount_cents, p_idempotency_key)
    on conflict (tenant_id, idempotency_key)
      where idempotency_key is not null do nothing;
    return jsonb_build_object(
      'appointment_id', p_appointment_id,
      'gift_card_id', v_card.id,
      'amount_cents', v_payment.amount_cents,
      'payment_id', v_payment.id,
      'redeemed', true, 'replayed', true
    );
  end if;

  insert into public.gift_card_redemptions
    (tenant_id, gift_card_id, appointment_id, appointment_payment_id,
     amount_cents, idempotency_key)
  values
    (v_tenant, v_card.id, p_appointment_id, v_payment.id,
     p_amount_cents, p_idempotency_key);

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (v_tenant, v_actor, 'gift_card_redeemed', 'appointment', p_appointment_id,
          jsonb_build_object('gift_card_id', v_card.id,
                             'amount_cents', p_amount_cents,
                             'payment_id', v_payment.id,
                             'idempotency_key', p_idempotency_key));

  select * into v_card from public.gift_cards where id = v_card.id;
  return jsonb_build_object(
    'appointment_id', p_appointment_id,
    'gift_card_id', v_card.id,
    'amount_cents', p_amount_cents,
    'payment_id', v_payment.id,
    'balance_cents', v_card.balance_cents,
    'status', v_card.status,
    'redeemed', true, 'replayed', false
  );
end;
$$;

-- Expiração (job/cron com service role ou admin): marca gift cards vencidos.
create or replace function public.expire_coupons_gift_cards()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_count int := 0;
begin
  if v_actor is not null and current_role_name() <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if v_actor is null then
    update public.gift_cards
       set status = 'expired', updated_at = now()
     where status = 'active'
       and valid_until is not null
       and valid_until < now();
    get diagnostics v_count = row_count;
  else
    update public.gift_cards
       set status = 'expired', updated_at = now()
     where tenant_id = current_tenant_id()
       and status = 'active'
       and valid_until is not null
       and valid_until < now();
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

-- Grants: RPCs públicas p/ authenticated (job/Edge usa service_role, bypassa).
revoke all on function public.coupon_validate(uuid, text) from public, anon;
grant execute on function public.coupon_validate(uuid, text) to authenticated;

revoke all on function public.apply_coupon_to_closing(uuid, text, uuid) from public, anon;
grant execute on function public.apply_coupon_to_closing(uuid, text, uuid) to authenticated;

revoke all on function public.gift_card_validate(text) from public, anon;
grant execute on function public.gift_card_validate(text) to authenticated;

revoke all on function public.redeem_gift_card(uuid, text, int, uuid, smallint) from public, anon;
grant execute on function public.redeem_gift_card(uuid, text, int, uuid, smallint) to authenticated;

revoke all on function public.expire_coupons_gift_cards() from public, anon;
grant execute on function public.expire_coupons_gift_cards() to authenticated;
