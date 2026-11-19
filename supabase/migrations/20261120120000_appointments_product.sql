-- Migration: ADR-05 — Varejo PDV (venda de produto) backend.
-- Adiciona `appointments.product_id` + `product_qty`, FK composta, XOR entre
-- service/combo/product, trigger de transição (comissão origin='product' +
-- consumo de estoque idempotente ao concluir). Aditiva e idempotente.

-- ----------------------------------------------------------------------------
-- 1. Colunas em appointments
-- ----------------------------------------------------------------------------
alter table public.appointments
  add column if not exists product_id uuid;
alter table public.appointments
  add column if not exists product_qty int not null default 0
    check (product_qty >= 0);

-- ----------------------------------------------------------------------------
-- 2. FK composta por tenant (nullable, MATCH SIMPLE).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_product_fk'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_product_fk
      foreign key (tenant_id, product_id)
      references public.products (tenant_id, id) on delete restrict;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. XOR: exatamente um entre service_id / combo_id / product_id.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'appointments_service_xor_combo'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      drop constraint appointments_service_xor_combo;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_item_xor'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_item_xor
      check (
        (service_id is not null and combo_id is null and product_id is null)
        or (service_id is null and combo_id is not null and product_id is null)
        or (service_id is null and combo_id is null and product_id is not null)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_product_qty_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_product_qty_check
      check (product_id is null or product_qty > 0);
  end if;
end
$$;

create index if not exists appointments_tenant_product_idx
  on public.appointments (tenant_id, product_id)
  where product_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Trigger de transição: produto -> comissão origin='product' + consumo estoque.
-- ----------------------------------------------------------------------------
create or replace function public.appointments_validate_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_origin text;
  v_pct numeric(5,2);
  v_backbar int;
  v_type text;
  v_commission int;
  v_auto_credit uuid;
  v_current int;
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status in ('concluido','cancelado','nao_compareceu') then
    raise exception 'Transicao de status invalida: % e um estado final e nao pode mudar para %',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  if not (
    (old.status = 'pendente'
      and new.status in ('confirmado','em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'confirmado'
      and new.status in ('em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'em_atendimento'
      and new.status in ('concluido','cancelado'))
  ) then
    raise exception 'Transicao de status invalida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'confirmado' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;

  if new.status = 'concluido' and old.status <> 'concluido' then
    if new.product_id is not null then
      v_origin := 'product';
      select coalesce(p.commission_pct, 0) into v_pct
        from public.products p
       where p.tenant_id = new.tenant_id and p.id = new.product_id;
      if v_pct is null then v_pct := 0; end if;
      v_backbar := 0;
      v_type := 'price';

      insert into public.appointment_product_commissions
        (tenant_id, appointment_id, product_id, professional_id, price_cents,
         commission_pct, commission_cents, backbar_cost_cents, origin)
      values
        (new.tenant_id, new.id, new.product_id, new.professional_id, new.price_cents,
         v_pct, round((new.price_cents * v_pct) / 100.0)::int, 0, 'product')
      on conflict (tenant_id, appointment_id, product_id) do nothing;

      -- Consumo de estoque idempotente (venda_pdv). Bloqueia se insuficiente.
      select stock_qty into v_current
        from public.products
       where tenant_id = new.tenant_id and id = new.product_id
       for update;
      if v_current is null then
        raise exception 'STOCK_PRODUCT_NOT_FOUND' using errcode = '23503';
      end if;
      if v_current - new.product_qty < 0 then
        raise exception 'STOCK_INSUFFICIENT' using errcode = 'PT409';
      end if;
      if not exists (
        select 1 from public.stock_movements
         where tenant_id = new.tenant_id
           and appointment_id = new.id
           and product_id = new.product_id
           and movement_type = 'consume'
      ) then
        insert into public.stock_movements
          (tenant_id, product_id, movement_type, qty_delta, reason, appointment_id, created_by)
        values
          (new.tenant_id, new.product_id, 'consume', -new.product_qty, 'venda_pdv', new.id, auth.uid());
      end if;
    elsif new.combo_id is not null then
      v_origin := 'combo';
      select coalesce(pc.commission_pct,0), coalesce(pc.commission_type,'price')
        into v_pct, v_type
        from professional_commissions pc
       where pc.tenant_id = new.tenant_id and pc.professional_id = new.professional_id;
      if v_pct is null then v_pct := 0; end if;
      v_backbar := 0;
      v_type := 'price';
    else
      v_origin := 'service';
      select coalesce(pc.commission_pct,0), coalesce(pc.commission_type,'price')
        into v_pct, v_type
        from professional_commissions pc
       where pc.tenant_id = new.tenant_id and pc.professional_id = new.professional_id;
      if v_pct is null then v_pct := 0; end if;
      select coalesce(s.backbar_cost_cents,0) into v_backbar
        from services s
       where s.tenant_id = new.tenant_id and s.id = new.service_id;
      if v_backbar is null then v_backbar := 0; end if;
    end if;

    -- appointment_commissions apenas para service/combo (produto usa tabela própria).
    if new.product_id is null then
      if v_type = 'margin' and v_origin = 'service' then
        v_commission := round( ((new.commission_base_cents - v_backbar) * v_pct) / 100.0 )::int;
      else
        v_commission := round( (new.commission_base_cents * v_pct) / 100.0 )::int;
      end if;
      if v_commission < 0 then v_commission := 0; end if;

      insert into appointment_commissions
        (tenant_id, appointment_id, professional_id, base_cents, commission_pct, commission_cents, origin, backbar_cost_cents)
      values
        (new.tenant_id, new.id, new.professional_id, new.commission_base_cents, v_pct, v_commission, v_origin, v_backbar)
      on conflict (tenant_id, appointment_id) do nothing;
    end if;
  end if;

  -- package credit auto-vinculo (só serviço).
  if new.status = 'concluido' and old.status <> 'concluido' then
    if new.package_credit_id is null
       and new.customer_id is not null
       and new.service_id is not null then
      select c.id into v_auto_credit
        from public.package_credits c
       where c.tenant_id = new.tenant_id
         and c.customer_id = new.customer_id
         and c.service_id = new.service_id
         and c.status = 'active'
         and c.expires_at > now()
         and c.used_sessions < c.total_sessions
       order by c.expires_at asc, c.created_at asc
       limit 1;
      if v_auto_credit is not null then
        new.package_credit_id := v_auto_credit;
      end if;
    end if;
    if new.package_credit_id is not null then
      perform public.package_consume(new.package_credit_id, new.id, true);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_transition_guard on public.appointments;
create trigger appointments_transition_guard
  before update of status on public.appointments
  for each row
  execute function public.appointments_validate_transition();

-- ----------------------------------------------------------------------------
-- 5. RPC create_walk_in_appointment: suporta product.
-- ----------------------------------------------------------------------------
drop function if exists public.create_walk_in_appointment(uuid, uuid, uuid, uuid, uuid, uuid, uuid);

create or replace function public.create_walk_in_appointment(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_professional_id uuid,
  p_service_id uuid default null,
  p_combo_id uuid default null,
  p_product_id uuid default null,
  p_product_qty int default 0,
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
  v_product_price int;
  v_product_stock int;
  v_product_active boolean;
  v_price_cents int;
  v_duration int;
  v_existing uuid;
  v_new_id uuid;
  v_starts_at timestamptz := now();
  v_ends_at timestamptz;
  v_non_null int;
begin
  if p_tenant_id is null or p_actor_id is null or p_professional_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_non_null := 0;
  if p_service_id is not null then v_non_null := v_non_null + 1; end if;
  if p_combo_id is not null then v_non_null := v_non_null + 1; end if;
  if p_product_id is not null then v_non_null := v_non_null + 1; end if;
  if v_non_null <> 1 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if p_product_id is not null then
    if p_product_qty is null or p_product_qty <= 0 then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;
  end if;

  select role into v_actor_role
  from public.profiles
  where id = p_actor_id and tenant_id = p_tenant_id and active = true
  limit 1;
  if v_actor_role is null or v_actor_role not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

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
  elsif p_combo_id is not null then
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
  else
    select price_cents, active, stock_qty into v_product_price, v_product_active, v_product_stock
    from public.products
    where tenant_id = p_tenant_id and id = p_product_id
    limit 1;
    if v_product_price is null or v_product_active is not true then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'PT404';
    end if;
    if v_product_stock < p_product_qty then
      raise exception 'STOCK_INSUFFICIENT' using errcode = 'PT409';
    end if;
    v_price_cents := v_product_price * p_product_qty;
    v_duration := 1;
  end if;

  if p_customer_id is not null then
    if not exists (
      select 1 from public.customers
      where tenant_id = p_tenant_id and id = p_customer_id
      limit 1
    ) then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
    end if;
  end if;

  v_ends_at := v_starts_at + make_interval(mins => greatest(v_duration, 1));

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
    service_id, combo_id, product_id, product_qty, starts_at, ends_at, price_cents,
    status, creation_idempotency_key, commission_base_cents
  ) values (
    p_tenant_id, 'walk_in', p_customer_id, p_professional_id,
    p_service_id, p_combo_id, p_product_id, coalesce(p_product_qty,0), v_starts_at, v_ends_at, v_price_cents,
    'em_atendimento', p_creation_idempotency_key, v_price_cents
  )
  returning id into v_new_id;

  insert into public.audit_log (
    tenant_id, actor_id, action, target_type, target_id, metadata
  ) values (
    p_tenant_id, p_actor_id, 'walk_in_created', 'appointment', v_new_id,
    jsonb_build_object('origin', 'walk_in', 'service_id', p_service_id, 'combo_id', p_combo_id, 'product_id', p_product_id, 'product_qty', p_product_qty)
  );

  return jsonb_build_object('id', v_new_id, 'reused', false);
end
$create_walk_in_appointment$;

revoke all on function public.create_walk_in_appointment(uuid, uuid, uuid, uuid, uuid, uuid, int, uuid, uuid)
  from anon, authenticated;
grant execute on function public.create_walk_in_appointment(uuid, uuid, uuid, uuid, uuid, uuid, int, uuid, uuid)
  to service_role;
