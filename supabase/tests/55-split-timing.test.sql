-- Teste split-timing (ADR-06): processamento separado de duração, herança do
-- serviço, default 0, conflito do profissional baseado apenas no atendimento.

create extension if not exists pgtap with schema extensions;
begin;
select plan(8);

-- Estrutura
select has_column('services', 'processing_minutes', 'services.processing_minutes existe');
select has_column('appointments', 'processing_minutes', 'appointments.processing_minutes existe');

-- Fixture
select tests.create_user('e0000000-0000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc','admin','Admin C');
insert into professionals (id, tenant_id, name) values
  ('e1111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Prof C');
insert into customers (id, tenant_id, name, phone) values
  ('e2222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Cliente C','11999999999');
insert into services (id, tenant_id, name, price_cents, duration_minutes, processing_minutes) values
  ('e3333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Coloracao',1000,30,45);

-- Herança: appointment sem processing_minutes herda do serviço (45).
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
values ('e4444444-4444-4444-8444-444444444444','cccccccc-cccc-4ccc-8ccc-cccccccccccc','e2222222-2222-4222-8222-222222222222','e1111111-1111-4111-8111-111111111111','e3333333-3333-4333-8333-333333333333', now(), now()+interval '30 min',1000,'pendente');

select is(
  (select processing_minutes from appointments where id='e4444444-4444-4444-8444-444444444444'),
  45,
  'appointment herda processing_minutes do service'
);

-- Default 0 para serviço sem processamento.
insert into services (id, tenant_id, name, price_cents, duration_minutes) values
  ('e5555555-5555-4555-8555-555555555555','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Corte',1000,30);
select is(
  (select processing_minutes from services where id='e5555555-5555-4555-8555-555555555555'),
  0,
  'service default processing_minutes = 0'
);

-- Dois appointments do mesmo profissional com atendimento não sobreposto mas
-- processamento sobreposto são permitidos (constraint usa duration apenas).
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status, processing_minutes)
values ('e6666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc','e2222222-2222-4222-8222-222222222222','e1111111-1111-4111-8111-111111111111','e5555555-5555-4555-8555-555555555555', now()+interval '30 min', now()+interval '60 min',1000,'pendente', 60);

select ok(
  exists (select 1 from appointments where id='e6666666-6666-4666-8666-666666666666'),
  'segundo appointment com processamento sobreposto permitido'
);

-- check >= 0: processamento negativo é rejeitado.
select throws_ok(
  $$insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status, processing_minutes)
     values ('e7777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc','e2222222-2222-4222-8222-222222222222','e1111111-1111-4111-8111-111111111111','e5555555-5555-4555-8555-555555555555', now()+interval '60 min', now()+interval '90 min',1000,'pendente', -1)$$,
  '23514', null,
  'processing_minutes negativo viola check'
);

-- snapshot imutável: update de processing_minutes é bloqueado.
select throws_ok(
  $$update appointments set processing_minutes = 10 where id='e4444444-4444-4444-8444-444444444444'$$,
  '23514', null,
  'processing_minutes imutavel apos INSERT'
);

-- default 0 em appointment (herança efetiva quando service processing 0).
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
values ('e8888888-8888-4888-8888-888888888888','cccccccc-cccc-4ccc-8ccc-cccccccccccc','e2222222-2222-4222-8222-222222222222','e1111111-1111-4111-8111-111111111111','e5555555-5555-4555-8555-555555555555', now()+interval '90 min', now()+interval '120 min',1000,'pendente');
select is(
  (select processing_minutes from appointments where id='e8888888-8888-4888-8888-888888888888'),
  0,
  'appointment default processing_minutes = 0'
);

rollback;