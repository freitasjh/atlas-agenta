-- Escopo de RLS anônima (ADR-04, critério 5; origem ADR-02).
-- Com o papel `anon` e sem JWT, as tabelas de domínio abaixo devem devolver zero linhas.
-- Os hooks dessas tabelas não têm gate de sessão próprio, então esta prova é a barreira.
--
-- Antes de provar o zero, o owner insere uma linha em cada tabela: sem fixture, zero linhas
-- seria verdade trivial e o teste não provaria nada. Tudo roda numa transação com rollback.

begin;

select plan(13);

-- Fixture como owner (bypassa RLS). Empresa única, com uma linha em cada tabela da lista.
insert into tenants (id, legal_name, owner_email)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Empresa anon', 'anon@teste.invalido');

insert into professionals (id, tenant_id, name)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Profissional anon');

insert into services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Serviço anon', 30, 5000);

insert into service_professionals (tenant_id, service_id, professional_id)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

insert into customers (id, tenant_id, name, phone)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Cliente anon', '5511999990000');

insert into working_hours (tenant_id, professional_id, weekday, start_time, end_time)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  1, '09:00', '18:00'
);

insert into schedule_overrides (tenant_id, professional_id, override_date, is_closed)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '2025-03-10', true
);

insert into whatsapp_instances (tenant_id, evolution_instance_name)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'instancia-anon');

insert into messages (tenant_id, customer_id, template)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'confirmacao'
);

insert into message_templates (tenant_id, template_key, body)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'confirmacao', 'Olá, {{nome}}.');

insert into professional_commissions (tenant_id, professional_id)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');

insert into combos (id, tenant_id, name, price_cents)
values ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Combo anon', 9000);

insert into combo_services (tenant_id, combo_id, service_id)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '99999999-9999-4999-8999-999999999999',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
);

-- Precondição: o owner enxerga a fixture nas 12 tabelas.
select ok(
  (select count(*) from customers) > 0
  and (select count(*) from services) > 0
  and (select count(*) from professionals) > 0
  and (select count(*) from combos) > 0
  and (select count(*) from messages) > 0
  and (select count(*) from message_templates) > 0
  and (select count(*) from whatsapp_instances) > 0
  and (select count(*) from professional_commissions) > 0
  and (select count(*) from working_hours) > 0
  and (select count(*) from schedule_overrides) > 0
  and (select count(*) from service_professionals) > 0
  and (select count(*) from combo_services) > 0,
  'fixture: owner enxerga pelo menos uma linha nas 12 tabelas'
);

-- Papel anon, sem JWT.
select tests.authenticate_as(null, 'anon');

select is((select count(*) from customers), 0::bigint, 'anon: customers sem linhas');
select is((select count(*) from services), 0::bigint, 'anon: services sem linhas');
select is((select count(*) from professionals), 0::bigint, 'anon: professionals sem linhas');
select is((select count(*) from combos), 0::bigint, 'anon: combos sem linhas');
select is((select count(*) from messages), 0::bigint, 'anon: messages sem linhas');
select is((select count(*) from message_templates), 0::bigint, 'anon: message_templates sem linhas');
select is((select count(*) from whatsapp_instances), 0::bigint, 'anon: whatsapp_instances sem linhas');
select is((select count(*) from professional_commissions), 0::bigint, 'anon: professional_commissions sem linhas');
select is((select count(*) from working_hours), 0::bigint, 'anon: working_hours sem linhas');
select is((select count(*) from schedule_overrides), 0::bigint, 'anon: schedule_overrides sem linhas');
select is((select count(*) from service_professionals), 0::bigint, 'anon: service_professionals sem linhas');
select is((select count(*) from combo_services), 0::bigint, 'anon: combo_services sem linhas');

select tests.clear_authentication();

select * from finish();

rollback;
