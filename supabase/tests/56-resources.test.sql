-- Teste de recursos agendáveis (ADR-07 Fase 3), pgTAP.
-- Prova: schema, RLS cross-tenant, RBAC, herança service->appointment,
-- conflito capacidade 1, capacidade 2, processamento, RPCs.

create extension if not exists pgtap with schema extensions;
begin;
select plan(23);

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
select has_table('resources', 'tabela resources existe');
select has_table('service_resources', 'tabela service_resources existe');
select has_table('appointment_resources', 'tabela appointment_resources existe');

select ok((select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='resources'), 'RLS ativa em resources');
select ok((select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='appointment_resources'), 'RLS ativa em appointment_resources');

-- Fixture
select tests.create_user('d0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin','Admin A');
select tests.create_user('d0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','receptionist','Recepcao A');
select tests.create_user('d0000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','professional','Prof A');
select tests.create_user('d0000000-0000-4000-8000-000000000004','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','admin','Admin B');

-- libera limite de profissionais para tenant A (premium)
update tenants set plan='premium' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into professionals (id, tenant_id, name, profile_id) values
  ('d1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Prof A','d0000000-0000-4000-8000-000000000003'),
  ('d1111111-1111-4111-8111-111111111112','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Prof A2',null),
  ('d2222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Prof B',null);

insert into customers (id, tenant_id, name, phone) values
  ('d3333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cliente A','11999999999');

insert into services (id, tenant_id, name, price_cents, duration_minutes, processing_minutes) values
  ('d4444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Corte',1000,30,15);

-- Admin A cria recurso capacidade 1
reset role;
select tests.authenticate_as('d0000000-0000-4000-8000-000000000001','authenticated');

select lives_ok(
  $$ insert into resources (id, tenant_id, name, type, capacity, color)
     values ('d5555555-5555-4555-8555-555555555551','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sala 1','sala',1,'#ff0000') $$,
  'admin cria recurso'
);

-- Receptionist não escreve recurso
reset role;
select tests.authenticate_as('d0000000-0000-4000-8000-000000000002','authenticated');

select is(
  pg_temp.try_stmt($$ insert into resources (tenant_id, name, type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','X','sala') $$),
  '42501',
  'receptionist não cria recurso (RLS nega)'
);

-- Receptionist lê recurso
select ok(
  (select count(*) from resources where id='d5555555-5555-4555-8555-555555555551') = 1,
  'receptionist lê recurso do tenant'
);

-- Tenant B não vê recurso A
reset role;
select tests.authenticate_as('d0000000-0000-4000-8000-000000000004','authenticated');
select is(
  (select count(*) from resources where id='d5555555-5555-4555-8555-555555555551')::int,
  0,
  'tenant B não vê recurso do tenant A'
);

-- Admin A vincula recurso ao serviço
reset role;
select tests.authenticate_as('d0000000-0000-4000-8000-000000000001','authenticated');
select lives_ok(
  $$ insert into service_resources (tenant_id, service_id, resource_id, qty)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d4444444-4444-4444-8444-444444444444','d5555555-5555-4555-8555-555555555551',1) $$,
  'admin vincula recurso ao serviço'
);

-- Herança: appointment do serviço herda recurso
select lives_ok(
  $$ insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
     values ('d6666666-6666-4666-8666-666666666661','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111111','d4444444-4444-4444-8444-444444444444',
             '2026-12-01T10:00:00Z','2026-12-01T10:30:00Z',1000,'pendente') $$,
  'appointment criado'
);
select ok(
  exists (select 1 from appointment_resources where appointment_id='d6666666-6666-4666-8666-666666666661' and resource_id='d5555555-5555-4555-8555-555555555551'),
  'herança: appointment herda service_resources'
);

-- Conflito capacidade 1: segundo appointment sobreposto bloqueado
select is(
  pg_temp.try_stmt($$ insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
     values ('d6666666-6666-4666-8666-666666666662','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111111','d4444444-4444-4444-8444-444444444444',
             '2026-12-01T10:15:00Z','2026-12-01T10:45:00Z',1000,'pendente') $$),
  '23P01',
  'conflito capacidade 1 bloqueia segundo appointment'
);

-- Processamento: appointment com recurso até 10:45; novo às 10:30 (atendimento não sobrepõe mas processamento sobrepõe) bloqueado
select is(
  pg_temp.try_stmt($$ insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
     values ('d6666666-6666-4666-8666-666666666663','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111111','d4444444-4444-4444-8444-444444444444',
             '2026-12-01T10:30:00Z','2026-12-01T11:00:00Z',1000,'pendente') $$),
  '23P01',
  'processamento sobreposto bloqueia recurso'
);

-- Capacidade 2: recurso r2
select lives_ok(
  $$ insert into resources (id, tenant_id, name, type, capacity) values ('d5555555-5555-4555-8555-555555555552','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cadeira 1','cadeira',2) $$,
  'recurso capacidade 2 criado'
);
-- service2 sem recurso? vincular r2 ao mesmo service via novo service
insert into services (id, tenant_id, name, price_cents, duration_minutes, processing_minutes) values
  ('d4444444-4444-4444-8444-444444444445','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Barba',800,20,0);
insert into service_resources (tenant_id, service_id, resource_id, qty) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d4444444-4444-4444-8444-444444444445','d5555555-5555-4555-8555-555555555552',1);

-- dois appointments simultâneos permitidos
select lives_ok(
  $$ insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
     values ('d6666666-6666-4666-8666-666666666664','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111111','d4444444-4444-4444-8444-444444444445',
             '2026-12-02T10:00:00Z','2026-12-02T10:20:00Z',800,'pendente') $$,
  'cap2: primeiro appointment permitido'
);
select lives_ok(
  $$ insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
     values ('d6666666-6666-4666-8666-666666666665','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111112','d4444444-4444-4444-8444-444444444445',
             '2026-12-02T10:00:00Z','2026-12-02T10:20:00Z',800,'pendente') $$,
  'cap2: segundo appointment permitido'
);
-- terceiro bloqueado
select is(
  pg_temp.try_stmt($$ insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
     values ('d6666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111111','d4444444-4444-4444-8444-444444444445',
             '2026-12-02T10:00:00Z','2026-12-02T10:20:00Z',800,'pendente') $$),
  '23P01',
  'cap2: terceiro appointment bloqueado'
);

-- check_resource_conflict RPC retorna false quando livre
reset role;
select tests.authenticate_as('d0000000-0000-4000-8000-000000000001','authenticated');
select is(
  public.check_resource_conflict('d5555555-5555-4555-8555-555555555552','2026-12-03T10:00:00Z'::timestamptz,'2026-12-03T10:20:00Z'::timestamptz,0,null,1),
  false,
  'check_resource_conflict livre retorna false'
);

-- reserve_resource + release_resource manual
select lives_ok(
  $$ select public.reserve_resource('d5555555-5555-4555-8555-555555555552','d6666666-6666-4666-8666-666666666664',1) $$,
  'reserve_resource manual ok'
);
-- release
select ok(
  public.release_resource('d5555555-5555-4555-8555-555555555552','d6666666-6666-4666-8666-666666666664'),
  'release_resource remove vínculo'
);

-- list_appointments_by_resource
select ok(
  (select count(*) from public.list_appointments_by_resource('d5555555-5555-4555-8555-555555555552','2026-12-02')) >= 1,
  'list_appointments_by_resource retorna appointments do dia'
);

-- professional lê próprio appointment_resources
reset role;
select tests.authenticate_as('d0000000-0000-4000-8000-000000000003','authenticated');
select ok(
  (select count(*) from appointment_resources where appointment_id='d6666666-6666-4666-8666-666666666661') >= 1,
  'professional lê appointment_resources do próprio appointment'
);

select * from finish();
rollback;