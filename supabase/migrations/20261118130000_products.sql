-- Migration: catálogo de produtos (backbar/varejo) do tenant (Fase 3 ADR-02).
-- Tabelas: `products` e `product_professionals` (N:N por tenant). Sem estoque aqui
-- (saldo/movimentações vivem em ADR-03). Isolamento por tenant_id do JWT via RLS;
-- escrita só admin; leitura aberta ao tenant (todo papel).

-- ============================================================================
-- 1. products
-- ============================================================================
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  sku            text,
  category       text not null check (category in ('backbar','retail','both')),
  unit           text not null check (char_length(unit) between 1 and 30),
  cost_cents     int not null check (cost_cents >= 0),
  price_cents    int not null check (price_cents >= 0),
  min_qty        int not null default 0 check (min_qty >= 0),
  active         bool not null default true,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  created_at     timestamptz not null default now(),
  constraint products_tenant_id_unique unique (tenant_id, id)
);

-- SKU único por tenant quando informado (idempotente).
create unique index if not exists products_tenant_sku_unique
  on products (tenant_id, sku) where sku is not null;

create index if not exists products_tenant_id_idx on products (tenant_id);
create index if not exists products_tenant_category_idx on products (tenant_id, category);

alter table products enable row level security;

drop policy if exists products_select_same_tenant on products;
create policy products_select_same_tenant on products for select
  using (tenant_id = current_tenant_id());

drop policy if exists products_write_admin on products;
create policy products_write_admin on products for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- ============================================================================
-- 2. product_professionals (N:N) — FKs compostas por tenant.
-- ============================================================================
create table if not exists product_professionals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  product_id      uuid not null,
  professional_id uuid not null,
  created_at      timestamptz not null default now(),
  constraint product_professionals_product_fk
    foreign key (tenant_id, product_id)
    references products (tenant_id, id) on delete cascade,
  constraint product_professionals_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete cascade,
  constraint product_professionals_unique
    unique (tenant_id, product_id, professional_id)
);

create index if not exists product_professionals_tenant_id_idx
  on product_professionals (tenant_id);
create index if not exists product_professionals_tenant_product_idx
  on product_professionals (tenant_id, product_id);
create index if not exists product_professionals_tenant_professional_idx
  on product_professionals (tenant_id, professional_id);

alter table product_professionals enable row level security;

drop policy if exists product_professionals_select_same_tenant on product_professionals;
create policy product_professionals_select_same_tenant on product_professionals for select
  using (tenant_id = current_tenant_id());

drop policy if exists product_professionals_write_admin on product_professionals;
create policy product_professionals_write_admin on product_professionals for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');
