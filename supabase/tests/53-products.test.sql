-- Teste de produtos (Fase 3 ADR-02), pgTAP.
-- Prova: schema, RLS cross-tenant, RBAC (receptionist lê/escreve negado),
-- N:N por tenant coerente, validações *_cents/commission_pct/category.

create extension if not exists pgtap with schema extensions;
begin;
select plan(15);

create or replace function pg_temp.try_stmt(stmt text)
returns text
language plpgsql
as $$
declare v_state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end;
$$;

-- Estrutura
select has_table('products', 'tabela products existe');
select has_table('product_professionals', 'tabela product_professionals existe');

select ok((select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='products'), 'RLS ativa em products');
select ok((select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='product_professionals'), 'RLS ativa em product_professionals');

-- Fixture
select tests.create_user('c0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin','Admin A');
select tests.create_user('c0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','receptionist','Recepcao A');
select tests.create_user('c0000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','professional','Prof A');
select tests.create_user('c0000000-0000-4000-8000-000000000004','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','admin','Admin B');

-- professional row
insert into professionals (id, tenant_id, name, profile_id) values
  ('c1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Prof A','c0000000-0000-4000-8000-000000000003'),
  ('c2222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Prof B',null);

-- Admin A cria produto
reset role;
select tests.authenticate_as('c0000000-0000-4000-8000-000000000001','authenticated');

select lives_ok(
  $$ insert into products (id, tenant_id, name, sku, category, unit, cost_cents, price_cents, min_qty, commission_pct)
     values ('c3333333-3333-4333-8333-333333333331','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Shampoo','SKU1','backbar','un',500,1200,2,10.5) $$,
  'admin cria produto'
);

-- Receptionist não escreve
reset role;
select tests.authenticate_as('c0000000-0000-4000-8000-000000000002','authenticated');

select is(
  pg_temp.try_stmt($$ insert into products (tenant_id, name, category, unit, cost_cents, price_cents)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','X','retail','un',1,2) $$),
  '42501',
  'receptionist não cria produto (RLS nega)'
);

-- Receptionist lê
select ok(
  (select count(*) from products where id='c3333333-3333-4333-8333-333333333331') = 1,
  'receptionist lê produto do tenant'
);

-- Tenant B não vê produto A
reset role;
select tests.authenticate_as('c0000000-0000-4000-8000-000000000004','authenticated');

select is(
  (select count(*) from products where id='c3333333-3333-4333-8333-333333333331')::int,
  0,
  'tenant B não vê produto do tenant A'
);

-- Validações de check
reset role;
select tests.authenticate_as('c0000000-0000-4000-8000-000000000001','authenticated');

select is(
  pg_temp.try_stmt($$ insert into products (tenant_id, name, category, unit, cost_cents, price_cents, commission_pct)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Y','backbar','un',1,2,150) $$),
  '23514',
  'commission_pct >100 negado'
);

select is(
  pg_temp.try_stmt($$ insert into products (tenant_id, name, category, unit, cost_cents, price_cents)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Z','invalid','un',1,2) $$),
  '23514',
  'category inválida negada'
);

select is(
  pg_temp.try_stmt($$ insert into products (tenant_id, name, category, unit, cost_cents, price_cents)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','W','backbar','un',-1,2) $$),
  '23514',
  'cost_cents negativo negado'
);

-- N:N válido
select lives_ok(
  $$ insert into product_professionals (tenant_id, product_id, professional_id)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3333333-3333-4333-8333-333333333331','c1111111-1111-4111-8111-111111111111') $$,
  'N:N produto-profissional válido'
);

-- N:N cross-tenant negado (FK composta)
select is(
  pg_temp.try_stmt($$ insert into product_professionals (tenant_id, product_id, professional_id)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3333333-3333-4333-8333-333333333331','c2222222-2222-4222-8222-222222222222') $$),
  '23503',
  'N:N cross-tenant negado (FK composta)'
);

-- Receptionist não escreve N:N
reset role;
select tests.authenticate_as('c0000000-0000-4000-8000-000000000002','authenticated');
select is(
  pg_temp.try_stmt($$ insert into product_professionals (tenant_id, product_id, professional_id)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3333333-3333-4333-8333-333333333331','c1111111-1111-4111-8111-111111111111') $$),
  '42501',
  'receptionist não cria vínculo N:N (RLS nega)'
);

-- Update admin ok
reset role;
select tests.authenticate_as('c0000000-0000-4000-8000-000000000001','authenticated');
select lives_ok(
  $$ update products set active=false, name='Shampoo Pro' where id='c3333333-3333-4333-8333-333333333331' $$,
  'admin atualiza produto'
);

select * from finish();
rollback;
