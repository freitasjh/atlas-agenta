-- Migration: estoque (saldo + movimentações) do tenant (Fase 3 ADR-03).
-- Tabela `stock_movements` (ledger append-only) + saldo em `products.stock_qty`
-- atualizado por trigger AFTER...BEFORE INSERT. RPCs SECURITY DEFINER.
-- Isolamento por tenant_id do JWT via RLS; RBAC admin/receptionist escrevem,
-- admin ajusta inventário, professional não escreve. Dinheiro em *_cents,
-- tempos timestamptz UTC.

-- ============================================================================
-- 0. products.stock_qty (saldo materializado, fonte = movimentos)
-- ============================================================================
alter table public.products
  add column if not exists stock_qty int not null default 0 check (stock_qty >= 0);

-- ============================================================================
-- 1. stock_movements
-- ============================================================================
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id()
                    references public.tenants (id) on delete cascade,
  product_id      uuid not null,
  movement_type   text not null check (movement_type in ('consume','replenish','adjust')),
  qty_delta       int not null,
  qty_before      int,
  qty_after       int,
  reason          text,
  appointment_id  uuid,
  batch           text,
  expires_at      timestamptz,
  supplier        text,
  unit_cost_cents int check (unit_cost_cents is null or unit_cost_cents >= 0),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint stock_movements_product_fk
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete restrict,
  constraint stock_movements_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict
);

create index if not exists stock_movements_tenant_product_created_idx
  on public.stock_movements (tenant_id, product_id, created_at desc);
create index if not exists stock_movements_tenant_created_idx
  on public.stock_movements (tenant_id, created_at desc);
create index if not exists stock_movements_tenant_appointment_idx
  on public.stock_movements (tenant_id, appointment_id)
  where appointment_id is not null;

-- idempotência de consumo por (tenant, appointment, product)
create unique index if not exists stock_movements_consume_idem_idx
  on public.stock_movements (tenant_id, appointment_id, product_id)
  where appointment_id is not null and movement_type = 'consume';

-- lote único por produto/tenant
create unique index if not exists stock_movements_tenant_product_batch_unique
  on public.stock_movements (tenant_id, product_id, batch)
  where batch is not null;

alter table public.stock_movements enable row level security;

drop policy if exists stock_movements_select_same_tenant on public.stock_movements;
create policy stock_movements_select_same_tenant on public.stock_movements for select
  using (tenant_id = current_tenant_id());

-- INSERT aberto a admin+receptionist (baixa/reposição operacional); professional não escreve.
drop policy if exists stock_movements_insert_operational on public.stock_movements;
create policy stock_movements_insert_operational on public.stock_movements for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  );

-- append-only: sem UPDATE/DELETE policy (RLS nega por default).

revoke all on table public.stock_movements from anon, authenticated;
grant select on table public.stock_movements to authenticated;
grant insert on table public.stock_movements to authenticated;
grant all on table public.stock_movements to service_role;

-- ============================================================================
-- 2. Trigger: aplica saldo e preenche qty_before/qty_after (BEFORE INSERT)
-- ============================================================================
create or replace function public.stock_movements_apply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before int;
  v_after  int;
begin
  if new.tenant_id is null then
    new.tenant_id := current_tenant_id();
  end if;

  select stock_qty into v_before
    from public.products
   where tenant_id = new.tenant_id and id = new.product_id
   for update;
  if not found then
    raise exception 'STOCK_PRODUCT_NOT_FOUND'
      using errcode = '23503';
  end if;

  v_after := v_before + new.qty_delta;
  if v_after < 0 then
    raise exception 'STOCK_NEGATIVE_NOT_ALLOWED'
      using errcode = '23514';
  end if;

  new.qty_before := v_before;
  new.qty_after  := v_after;

  update public.products
     set stock_qty = v_after
   where tenant_id = new.tenant_id and id = new.product_id;

  return new;
end;
$$;

drop trigger if exists stock_movements_apply_trg on public.stock_movements;
create trigger stock_movements_apply_trg
  before insert on public.stock_movements
  for each row execute function public.stock_movements_apply();

-- ============================================================================
-- 3. RPCs
-- ============================================================================
-- consume_stock: baixa por atendimento; idempotente por (tenant, appointment, product).
create or replace function public.consume_stock(
  p_product_id     uuid,
  p_qty            int,
  p_appointment_id uuid default null,
  p_reason         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_role     text;
  v_existing uuid;
  v_current  int;
  v_movement uuid;
begin
  v_tenant := current_tenant_id();
  v_role   := current_role_name();
  if v_tenant is null or coalesce(v_role,'__none') not in ('admin','receptionist') then
    raise exception 'STOCK_CONSUME_DENIED'
      using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'STOCK_QTY_INVALID'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.products where tenant_id = v_tenant and id = p_product_id) then
    raise exception 'STOCK_PRODUCT_NOT_FOUND'
      using errcode = '23503';
  end if;
  if p_appointment_id is not null then
    select id into v_existing
      from public.stock_movements
     where tenant_id = v_tenant
       and appointment_id = p_appointment_id
       and product_id = p_product_id
       and movement_type = 'consume'
     limit 1;
    if found then
      return v_existing;
    end if;
  end if;

  select stock_qty into v_current
    from public.products
   where tenant_id = v_tenant and id = p_product_id
   for update;
  if v_current - p_qty < 0 then
    raise exception 'STOCK_NEGATIVE_NOT_ALLOWED'
      using errcode = '23514';
  end if;

  insert into public.stock_movements
    (tenant_id, product_id, movement_type, qty_delta, reason, appointment_id, created_by)
  values
    (v_tenant, p_product_id, 'consume', -p_qty, p_reason, p_appointment_id, auth.uid())
  returning id into v_movement;

  return v_movement;
end;
$$;

-- replenish_stock: reposição (lote/validade/fornecedor).
create or replace function public.replenish_stock(
  p_product_id      uuid,
  p_qty             int,
  p_batch           text default null,
  p_expires_at      timestamptz default null,
  p_supplier        text default null,
  p_unit_cost_cents int default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_role     text;
  v_movement uuid;
begin
  v_tenant := current_tenant_id();
  v_role   := current_role_name();
  if v_tenant is null or coalesce(v_role,'__none') not in ('admin','receptionist') then
    raise exception 'STOCK_REPLENISH_DENIED'
      using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'STOCK_QTY_INVALID'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.products where tenant_id = v_tenant and id = p_product_id) then
    raise exception 'STOCK_PRODUCT_NOT_FOUND'
      using errcode = '23503';
  end if;

  insert into public.stock_movements
    (tenant_id, product_id, movement_type, qty_delta, batch, expires_at, supplier, unit_cost_cents, created_by)
  values
    (v_tenant, p_product_id, 'replenish', p_qty, p_batch, p_expires_at, p_supplier, p_unit_cost_cents, auth.uid())
  returning id into v_movement;

  return v_movement;
end;
$$;

-- adjust_stock: ajuste de inventário (motivo obrigatório), admin only.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_qty_delta  int,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_role     text;
  v_movement uuid;
begin
  v_tenant := current_tenant_id();
  v_role   := current_role_name();
  if v_tenant is null or coalesce(v_role,'__none') <> 'admin' then
    raise exception 'STOCK_ADJUST_DENIED'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'STOCK_REASON_REQUIRED'
      using errcode = '23514';
  end if;
  if p_qty_delta is null or p_qty_delta = 0 then
    raise exception 'STOCK_QTY_INVALID'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.products where tenant_id = v_tenant and id = p_product_id) then
    raise exception 'STOCK_PRODUCT_NOT_FOUND'
      using errcode = '23503';
  end if;

  insert into public.stock_movements
    (tenant_id, product_id, movement_type, qty_delta, reason, created_by)
  values
    (v_tenant, p_product_id, 'adjust', p_qty_delta, p_reason, auth.uid())
  returning id into v_movement;

  return v_movement;
end;
$$;

-- get_stock_balance / get_stock_level
create or replace function public.get_stock_balance(p_product_id uuid)
returns int
language sql
security invoker
set search_path = public
as $$
  select coalesce(stock_qty, 0) from public.products
   where tenant_id = current_tenant_id() and id = p_product_id;
$$;

create or replace function public.get_stock_level(p_product_id uuid)
returns int
language sql
security invoker
set search_path = public
as $$
  select public.get_stock_balance(p_product_id);
$$;

-- list_low_stock: produtos com status low/critical
create or replace function public.list_low_stock()
returns table (
  product_id   uuid,
  product_name text,
  stock_qty    int,
  min_qty      int,
  status       text
)
language sql
security invoker
set search_path = public
as $$
  select p.id, p.name, p.stock_qty, p.min_qty,
    case
      when p.stock_qty <= 0 then 'critical'
      when p.min_qty > 0 and p.stock_qty <= (p.min_qty / 2) then 'critical'
      when p.stock_qty <= p.min_qty then 'low'
      else 'ok'
    end as status
  from public.products p
  where p.tenant_id = current_tenant_id()
    and p.active
    and p.stock_qty <= p.min_qty
  order by p.name;
$$;

-- get_stock_alerts: low/critical + a vencer (30 dias)
create or replace function public.get_stock_alerts()
returns table (
  product_id       uuid,
  product_name     text,
  stock_qty        int,
  min_qty          int,
  status           text,
  next_expires_at  timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select p.id, p.name, p.stock_qty, p.min_qty,
    case
      when p.stock_qty <= 0 then 'critical'
      when p.min_qty > 0 and p.stock_qty <= (p.min_qty / 2) then 'critical'
      when p.stock_qty <= p.min_qty then 'low'
      else 'ok'
    end as status,
    (select min(sm.expires_at) from public.stock_movements sm
       where sm.tenant_id = p.tenant_id and sm.product_id = p.id
         and sm.expires_at is not null and sm.expires_at > now()) as next_expires_at
  from public.products p
  where p.tenant_id = current_tenant_id()
    and p.active
    and (
      p.stock_qty <= p.min_qty
      or exists (
        select 1 from public.stock_movements sm
         where sm.tenant_id = p.tenant_id and sm.product_id = p.id
           and sm.expires_at is not null
           and sm.expires_at <= now() + interval '30 days'
           and sm.expires_at > now()
      )
    )
  order by p.name;
$$;

-- ============================================================================
-- 4. Grants
-- ============================================================================
revoke all on function public.consume_stock(uuid, int, uuid, text) from public, anon;
grant execute on function public.consume_stock(uuid, int, uuid, text) to authenticated, service_role;

revoke all on function public.replenish_stock(uuid, int, text, timestamptz, text, int) from public, anon;
grant execute on function public.replenish_stock(uuid, int, text, timestamptz, text, int) to authenticated, service_role;

revoke all on function public.adjust_stock(uuid, int, text) from public, anon;
grant execute on function public.adjust_stock(uuid, int, text) to authenticated, service_role;

revoke all on function public.get_stock_balance(uuid) from public, anon;
grant execute on function public.get_stock_balance(uuid) to authenticated, service_role, anon;

revoke all on function public.get_stock_level(uuid) from public, anon;
grant execute on function public.get_stock_level(uuid) to authenticated, service_role, anon;

revoke all on function public.list_low_stock() from public, anon;
grant execute on function public.list_low_stock() to authenticated, service_role;

revoke all on function public.get_stock_alerts() from public, anon;
grant execute on function public.get_stock_alerts() to authenticated, service_role;