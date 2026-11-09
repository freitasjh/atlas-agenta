-- Escopo de RLS anônima (ADR-04, critério 5; origem ADR-02).
-- Com o papel `anon` e sem JWT, as 17 tabelas de `public` que têm grant a `anon` devem:
--   1. devolver zero linhas em SELECT;
--   2. não alterar nem apagar nenhuma linha em UPDATE e DELETE (0 linhas afetadas; em profiles,
--      DELETE recebe 42501 de permissão, ver ADR-02);
--   3. recusar INSERT com erro de privilégio/RLS (SQLSTATE 42501).
-- Os hooks dessas tabelas não têm gate de sessão próprio, então estas provas são a barreira.
--
-- Antes de provar o zero, o owner insere uma linha em cada tabela: sem fixture, zero linhas
-- seria verdade trivial e o teste não provaria nada. Tudo roda numa transação com rollback.
-- O papel `anon` não chama helpers de `tests`: a sessão volta ao owner com `reset role`.

begin;

select plan(36); -- 1 precondição + 17 leituras + 1 UPDATE/DELETE (17 tabelas) + 17 INSERTs

-- Fixture como owner (bypassa RLS). Empresa única, com uma linha em cada tabela.
select tests.create_user(
  '33333333-3333-4333-8333-333333333333',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'admin',
  'Admin anon'
);

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

insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents)
values (
  '12121212-1212-4121-8121-121212121212',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '2025-03-11 12:00+00', '2025-03-11 12:30+00', 5000
);

insert into appointment_commissions (tenant_id, appointment_id, professional_id, base_cents, commission_pct, commission_cents)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '12121212-1212-4121-8121-121212121212',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  5000, 10, 500
);

insert into webhook_events (tenant_id, external_event_id, instance_name)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'evt-anon', 'instancia-anon');

-- Precondição: o owner enxerga a fixture nas 17 tabelas.
select ok(
  (select count(*) from tenants) > 0
  and (select count(*) from profiles) > 0
  and (select count(*) from customers) > 0
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
  and (select count(*) from combo_services) > 0
  and (select count(*) from appointments) > 0
  and (select count(*) from appointment_commissions) > 0
  and (select count(*) from webhook_events) > 0,
  'fixture: owner enxerga pelo menos uma linha nas 17 tabelas'
);

-- Papel anon, sem JWT. A partir daqui só o papel anon executa.
select tests.authenticate_as(null, 'anon');

-- Leitura: zero linhas em cada tabela.
select is((select count(*) from tenants), 0::bigint, 'anon: tenants sem linhas (leitura)');
select is((select count(*) from profiles), 0::bigint, 'anon: profiles sem linhas (leitura)');
select is((select count(*) from customers), 0::bigint, 'anon: customers sem linhas (leitura)');
select is((select count(*) from services), 0::bigint, 'anon: services sem linhas (leitura)');
select is((select count(*) from professionals), 0::bigint, 'anon: professionals sem linhas (leitura)');
select is((select count(*) from combos), 0::bigint, 'anon: combos sem linhas (leitura)');
select is((select count(*) from messages), 0::bigint, 'anon: messages sem linhas (leitura)');
select is((select count(*) from message_templates), 0::bigint, 'anon: message_templates sem linhas (leitura)');
select is((select count(*) from whatsapp_instances), 0::bigint, 'anon: whatsapp_instances sem linhas (leitura)');
select is((select count(*) from professional_commissions), 0::bigint, 'anon: professional_commissions sem linhas (leitura)');
select is((select count(*) from working_hours), 0::bigint, 'anon: working_hours sem linhas (leitura)');
select is((select count(*) from schedule_overrides), 0::bigint, 'anon: schedule_overrides sem linhas (leitura)');
select is((select count(*) from service_professionals), 0::bigint, 'anon: service_professionals sem linhas (leitura)');
select is((select count(*) from combo_services), 0::bigint, 'anon: combo_services sem linhas (leitura)');
select is((select count(*) from appointments), 0::bigint, 'anon: appointments sem linhas (leitura)');
select is((select count(*) from appointment_commissions), 0::bigint, 'anon: appointment_commissions sem linhas (leitura)');
select is((select count(*) from webhook_events), 0::bigint, 'anon: webhook_events sem linhas (leitura)');

-- UPDATE e DELETE: cada tabela é tentada como anon; a lista guarda o nome das tabelas em que
-- alguma linha foi afetada. Esperado: vazio. Se a RLS falhar, o erro mostra a tabela.
do $$
declare
  alvo     record;
  n        bigint;
  afetadas text := '';
begin
  for alvo in
    select * from (values
      ('tenants', 'legal_name'),
      ('profiles', 'tenant_id'),
      ('customers', 'tenant_id'),
      ('services', 'tenant_id'),
      ('professionals', 'tenant_id'),
      ('combos', 'tenant_id'),
      ('messages', 'tenant_id'),
      ('message_templates', 'tenant_id'),
      ('whatsapp_instances', 'tenant_id'),
      ('professional_commissions', 'tenant_id'),
      ('working_hours', 'tenant_id'),
      ('schedule_overrides', 'tenant_id'),
      ('service_professionals', 'tenant_id'),
      ('combo_services', 'tenant_id'),
      ('appointments', 'tenant_id'),
      ('appointment_commissions', 'tenant_id'),
      ('webhook_events', 'tenant_id')
    ) as v(tabela, coluna)
  loop
    -- Sem privilégio de tabela (42501 antes da RLS) também conta como "0 linhas
    -- afetadas": a trava é mais forte que a policy. Vale para UPDATE e DELETE.
    begin
      execute format('update %I set %I = %I', alvo.tabela, alvo.coluna, alvo.coluna);
      get diagnostics n = row_count;
      if n > 0 then afetadas := afetadas || alvo.tabela || ' (update) '; end if;
    exception when insufficient_privilege then
      -- sem UPDATE de tabela: 0 linhas por desenho (ex.: profiles, tenants).
    end;

    -- profiles: anon não tem DELETE de tabela (ADR-02, aprovação do usuário). tenants: anon não
    -- tem DELETE de tabela (ADR-03, review). O comando recebe 42501 antes da RLS, e a linha
    -- continua. Nas demais tabelas, DELETE sem erro e 0 linhas.
    begin
      execute format('delete from %I', alvo.tabela);
      get diagnostics n = row_count;
      if n > 0 then afetadas := afetadas || alvo.tabela || ' (delete) '; end if;
    exception when insufficient_privilege then
      if alvo.tabela not in ('profiles', 'tenants') then raise; end if;
    end;
  end loop;

  perform set_config('tests.anon_linhas_afetadas', afetadas, true);
end
$$;

select is(
  current_setting('tests.anon_linhas_afetadas'),
  '',
  'anon: update e delete não afetam linhas nas 17 tabelas'
);

-- INSERT: recusado por RLS (ou por falta de grant), com SQLSTATE 42501.
select throws_ok(
  $$insert into tenants (legal_name, owner_email) values ('Intruso', 'intruso@teste.invalido')$$,
  '42501', null, 'anon: insert em tenants recusado'
);
select throws_ok(
  $$insert into profiles (id, tenant_id, role) values ('44444444-4444-4444-8444-444444444444', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin')$$,
  '42501', null, 'anon: insert em profiles recusado'
);
select throws_ok(
  $$insert into customers (tenant_id, name, phone) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Intruso', '5511900000001')$$,
  '42501', null, 'anon: insert em customers recusado'
);
select throws_ok(
  $$insert into services (tenant_id, name, duration_minutes, price_cents) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Intruso', 30, 5000)$$,
  '42501', null, 'anon: insert em services recusado'
);
select throws_ok(
  $$insert into professionals (tenant_id, name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Intruso')$$,
  '42501', null, 'anon: insert em professionals recusado'
);
select throws_ok(
  $$insert into combos (tenant_id, name, price_cents) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Intruso', 9000)$$,
  '42501', null, 'anon: insert em combos recusado'
);
select throws_ok(
  $$insert into messages (tenant_id, customer_id, template) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'confirmacao')$$,
  '42501', null, 'anon: insert em messages recusado'
);
select throws_ok(
  $$insert into message_templates (tenant_id, template_key, body) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'confirmacao', 'Intruso')$$,
  '42501', null, 'anon: insert em message_templates recusado'
);
select throws_ok(
  $$insert into whatsapp_instances (tenant_id, evolution_instance_name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'instancia-intruso')$$,
  '42501', null, 'anon: insert em whatsapp_instances recusado'
);
select throws_ok(
  $$insert into professional_commissions (tenant_id, professional_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$,
  '42501', null, 'anon: insert em professional_commissions recusado'
);
select throws_ok(
  $$insert into working_hours (tenant_id, professional_id, weekday, start_time, end_time) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2, '09:00', '18:00')$$,
  '42501', null, 'anon: insert em working_hours recusado'
);
select throws_ok(
  $$insert into schedule_overrides (tenant_id, professional_id, override_date, is_closed) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '2025-03-11', true)$$,
  '42501', null, 'anon: insert em schedule_overrides recusado'
);
select throws_ok(
  $$insert into service_professionals (tenant_id, service_id, professional_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$,
  '42501', null, 'anon: insert em service_professionals recusado'
);
select throws_ok(
  $$insert into combo_services (tenant_id, combo_id, service_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '99999999-9999-4999-8999-999999999999', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  '42501', null, 'anon: insert em combo_services recusado'
);
select throws_ok(
  $$insert into appointments (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2025-03-12 12:00+00', '2025-03-12 12:30+00', 5000)$$,
  '42501', null, 'anon: insert em appointments recusado'
);
select throws_ok(
  $$insert into appointment_commissions (tenant_id, appointment_id, professional_id, base_cents, commission_pct, commission_cents) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '12121212-1212-4121-8121-121212121212', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 5000, 10, 500)$$,
  '42501', null, 'anon: insert em appointment_commissions recusado'
);
select throws_ok(
  $$insert into webhook_events (tenant_id, external_event_id, instance_name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'evt-intruso', 'instancia-intruso')$$,
  '42501', null, 'anon: insert em webhook_events recusado'
);

-- Volta ao owner da sessão.
reset role;

select * from finish();

rollback;
