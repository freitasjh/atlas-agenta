-- Teste de schema de clinical_records (ADR-05), pgTAP.
-- Roda como owner da sessão (`supabase test db`) para constraints, índices e FKs. Os testes de
-- oráculo (22 e 23) trocam para o papel `authenticated` com `tests.authenticate_as`, porque a
-- pergunta ali é o que um usuário de outro tenant consegue descobrir. A RLS de leitura e
-- inserção em si é da ADR-06.
-- Prova: conteúdo mínimo (espaço, tab e quebra de linha), limites, unicidade de original e de
-- correção, amarração de tenant, atendimento e cliente, índice da FK de atendimento e que o
-- trigger de `supersedes_id` não revela existência entre tenants.
-- Fixture própria, domínio `.invalido` (guarda do harness, ADR-04). Roda numa transação e dá
-- rollback: nada persiste no banco de teste.
create extension if not exists pgtap with schema extensions;
begin;
select plan(23);

-- Fixture: tenant A (clínica) com cliente, profissional, serviço e três atendimentos.
-- Tenant B com um cliente próprio, para provar a amarração entre tenants.
insert into tenants (id, legal_name, owner_email, segment, plan) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Clínica A (teste)', 'clinica-a@teste.invalido', 'clinica', 'clinica'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Clínica B (teste)', 'clinica-b@teste.invalido', 'clinica', 'clinica');

insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A1', '+5511900000001'),
  ('a3333333-3333-4333-8333-333333333332', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A2', '+5511900000002'),
  ('b3333333-3333-4333-8333-333333333331', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cliente B1', '+5511900000003');

insert into professionals (id, tenant_id, name) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A');

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Consulta A', 60, 15000);

-- Três atendimentos no mesmo profissional, em janelas que não se sobrepõem.
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents) values
  ('a4444444-4444-4444-8444-444444444441', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 10:00:00+00', '2030-03-10 11:00:00+00', 15000),
  ('a4444444-4444-4444-8444-444444444442', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 13:00:00+00', '2030-03-10 14:00:00+00', 15000),
  ('a4444444-4444-4444-8444-444444444443', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 15:00:00+00', '2030-03-10 16:00:00+00', 15000),
  -- Atendimento do cliente A2 (usado no teste 12, para isolar a FK de correção).
  ('a4444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 17:00:00+00', '2030-03-10 18:00:00+00', 15000);

-- Fixture do tenant B: um original real, para o oráculo de existência entre tenants (22 e 23).
insert into professionals (id, tenant_id, name) values
  ('b1111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Profissional B');

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('b2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Consulta B', 60, 15000);

insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents) values
  ('b4444444-4444-4444-8444-444444444441', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331', 'b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', '2030-03-11 10:00:00+00', '2030-03-11 11:00:00+00', 15000);

insert into clinical_records (id, tenant_id, customer_id, appointment_id, clinical_notes, created_by) values
  ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b3333333-3333-4333-8333-333333333331', 'b4444444-4444-4444-8444-444444444441',
   'Original do tenant B', '99999999-9999-4999-8999-999999999999');

-- 1. RLS ligado na tabela.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.clinical_records'::regclass),
  'clinical_records tem RLS habilitado'
);

-- 2. Os três campos nulos são recusados (conteúdo mínimo).
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444441', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'registro sem nenhum campo preenchido é recusado'
);

-- 3. Campo só com espaços é recusado.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, allergies, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444441', '     ', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'campo só com espaços é recusado'
);

-- 4. Alergias com 501 caracteres é recusada.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, allergies, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444441', repeat('a', 501), '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'alergias com 501 caracteres é recusada'
);

-- 5. Alergias com 500 caracteres é aceita (no atendimento 2, sem original ainda).
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, allergies, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444442', repeat('a', 500), '99999999-9999-4999-8999-999999999999')
  $sql$,
  'alergias com 500 caracteres é aceita'
);

-- 6. Observações com 2001 caracteres é recusada.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444441', repeat('a', 2001), '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'observações com 2001 caracteres é recusada'
);

-- 7. Observações com 2000 caracteres é aceita (no atendimento 3).
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444443', repeat('a', 2000), '99999999-9999-4999-8999-999999999999')
  $sql$,
  'observações com 2000 caracteres é aceita'
);

-- 8. Original no atendimento 1 é aceito (base para os testes de unicidade e correção).
select lives_ok(
  $sql$
    insert into clinical_records (id, tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('c5555555-5555-4555-8555-555555555551', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444441',
            'Observação original', '99999999-9999-4999-8999-999999999999')
  $sql$,
  'original no atendimento é aceito'
);

-- 9. Segundo original para o mesmo atendimento é recusado.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444441', 'Segundo original', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23505',
  null,
  'segundo original para o mesmo atendimento é recusado'
);

-- 10. Primeira correção do original é aceita (mesmo atendimento e mesmo cliente).
select lives_ok(
  $sql$
    insert into clinical_records (id, tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('c6666666-6666-4666-8666-666666666661', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444441',
            'c5555555-5555-4555-8555-555555555551', 'Correção da observação', '99999999-9999-4999-8999-999999999999')
  $sql$,
  'primeira correção do registro é aceita'
);

-- 11. Segunda correção do mesmo registro é recusada.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444441', 'c5555555-5555-4555-8555-555555555551',
            'Segunda correção', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23505',
  null,
  'segunda correção do mesmo registro é recusada'
);

-- 12. Correção de outro cliente é recusada pela FK de correção. O atendimento usado é do cliente A2
-- (fixture própria), então as FKs de cliente e de atendimento passam, e só a FK de correção falha.
-- Aponta para a correção 6666 (sem sucessora), para o índice de correção única não barrar antes.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
            'a4444444-4444-4444-8444-444444444444', 'c6666666-6666-4666-8666-666666666661',
            'Correção com outro cliente', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23503',
  'insert or update on table "clinical_records" violates foreign key constraint "clinical_records_supersedes_fk"',
  'correção de outro cliente é recusada pela FK clinical_records_supersedes_fk'
);

-- 13. Registro com tenant B e atendimento do tenant A é recusado.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444442', 'Atendimento de outro tenant', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23503',
  null,
  'tenant de um registro com atendimento de outro tenant é recusado'
);

-- 14. Correção de outro atendimento do mesmo cliente é recusada pela FK de correção. Aponta para
-- a correção 6666 (sem sucessora), para o índice de correção única não barrar antes da FK. O
-- cliente é o mesmo (A1) e o atendimento 442 tem A1, então as FKs de cliente e de atendimento
-- passam: só a FK de correção falha.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444442', 'c6666666-6666-4666-8666-666666666661',
            'Correção em outro atendimento', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23503',
  'insert or update on table "clinical_records" violates foreign key constraint "clinical_records_supersedes_fk"',
  'correção de registro de outro atendimento do mesmo cliente é recusada pela FK de correção'
);

-- 15. Check clinical_records_supersedes_not_self isolada. Em uso normal, o trigger de existência
-- (BEFORE) recusa a auto-referência antes da check, então a check é defesa em profundidade. Para
-- provar a check sozinha, o trigger é desligado só dentro desta transação (rollback no fim).
alter table clinical_records disable trigger clinical_records_supersedes_exists;
select throws_ok(
  $sql$
    insert into clinical_records (id, tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('c7777777-7777-4777-8777-777777777771', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444442',
            'c7777777-7777-4777-8777-777777777771', 'Auto-correção', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  'new row for relation "clinical_records" violates check constraint "clinical_records_supersedes_not_self"',
  'check clinical_records_supersedes_not_self recusa registro que aponta para si mesmo'
);
alter table clinical_records enable trigger clinical_records_supersedes_exists;

-- 16. Dois registros que se apontam no mesmo insert são recusados. O primeiro aponta para um id
-- que ainda não existe no momento da linha, então o trigger recusa antes da FK ver o segundo.
select throws_ok(
  $sql$
    insert into clinical_records (id, tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by) values
      ('c8888888-8888-4888-8888-888888888881', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444442',
       'c8888888-8888-4888-8888-888888888882', 'Ciclo 1', '99999999-9999-4999-8999-999999999999'),
      ('c8888888-8888-4888-8888-888888888882', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444442',
       'c8888888-8888-4888-8888-888888888881', 'Ciclo 2', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23503',
  null,
  'dois registros que se apontam no mesmo insert são recusados'
);

-- 17. Campo com espaço nas pontas é recusado: o valor gravado precisa vir sem espaços.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, medications, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444442', '  Dipirona  ', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'campo com espaço nas pontas é recusado'
);

-- 18. Campo só com tab e quebra de linha (sem espaço) é recusado: o critério de vazio cobre espaço,
-- tab, CR e LF (E' \t\r\n'), não só espaço.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, allergies, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444442', E'\t\n', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'campo só com tab e quebra de linha é recusado'
);

-- 19. Campo com tab nas pontas é recusado, mesmo com texto no meio.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, medications, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444442', E'\tDipirona', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'campo com tab nas pontas é recusado'
);

-- 20. Índice cobre a FK de atendimento (tenant, atendimento, cliente): apagar ou trocar atendimento
-- não varre a tabela inteira.
select has_index(
  'clinical_records',
  'clinical_records_tenant_appointment_customer_idx',
  array['tenant_id', 'appointment_id', 'customer_id'],
  'índice da FK de atendimento existe'
);

-- 21. anon e authenticated não têm nenhum privilégio de tabela em clinical_records (TRUNCATE
-- incluído, porque RLS não o cobre).
select ok(
  not has_table_privilege('anon', 'public.clinical_records', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.clinical_records', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'anon e authenticated sem privilégio de tabela em clinical_records'
);

-- Oráculo de existência entre tenants (22 e 23). Usuário do tenant A, com `tenant_id` de B informado
-- no insert (o cliente não deveria fazer isso, mas o banco não pode vazar se fizer). O alvo é um
-- original real de B. Concede select e insert só aqui, no papel authenticated, dentro desta
-- transação (rollback). O trigger roda antes da RLS e da FK, e o resultado tem que ser igual ao de
-- um id inexistente: mesmo SQLSTATE e mesma mensagem. Com RLS sem policy, o trigger não enxerga o
-- registro de B; se o trigger fosse security definer, enxergaria e a falha seria 42501.
grant select, insert on clinical_records to authenticated;
select tests.create_user(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'admin',
  'Oráculo A'
);
select tests.authenticate_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated');

-- 22. Id existente de outro tenant: 23503 com a mensagem fixa, sem revelar que o registro existe.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331',
            'b4444444-4444-4444-8444-444444444441', 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
            'Correção de outro tenant', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  $sql$,
  '23503',
  'supersedes_id does not reference an existing record',
  'id de registro de outro tenant é recusado com a mensagem fixa de inexistente'
);

-- 23. Id inexistente: mesma resposta do teste 22.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331',
            'b4444444-4444-4444-8444-444444444441', 'c9999999-9999-4999-8999-999999999999',
            'Correção de id inexistente', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  $sql$,
  '23503',
  'supersedes_id does not reference an existing record',
  'id inexistente é recusado com a mesma resposta do id de outro tenant'
);

reset role;
select tests.clear_authentication();

select * from finish();
rollback;
