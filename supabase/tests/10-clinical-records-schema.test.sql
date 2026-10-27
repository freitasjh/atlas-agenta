-- Teste de schema de clinical_records (ADR-05), pgTAP.
-- Roda como owner da sessão (`supabase test db`) para constraints, índices e FKs. Os testes de
-- oráculo (22 e 23) trocam para o papel `authenticated` com `tests.authenticate_as`, porque a
-- pergunta ali é o que um usuário de outro tenant consegue descobrir. A RLS de leitura e
-- inserção em si é da ADR-06.
-- Prova: conteúdo mínimo (espaço, tab e quebra de linha), limites, unicidade de original e de
-- correção, amarração de tenant, atendimento e cliente, índice da FK de atendimento, que o
-- trigger de `supersedes_id` não revela existência entre tenants e que NENHUM erro de conteúdo
-- ecoa o texto clínico (mensagem, DETAIL ou HINT).
-- Fixture própria, domínio `.invalido` (guarda do harness, ADR-04). Roda numa transação e dá
-- rollback: nada persiste no banco de teste.
create extension if not exists pgtap with schema extensions;
begin;
select plan(39);

-- Helper local (pg_temp, some com a transação). Executa o statement e devolve
-- SQLSTATE | nome da constraint (ou '-') | 'true' se o marcador aparece na mensagem, no DETAIL ou
-- no HINT da exceção. 'ok' se o statement passou.
create or replace function pg_temp.clinical_probe(stmt text, marker text)
returns text
language plpgsql
as $$
declare
  v_state      text;
  v_msg        text;
  v_detail     text;
  v_hint       text;
  v_constraint text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics
    v_state      = returned_sqlstate,
    v_msg        = message_text,
    v_detail     = pg_exception_detail,
    v_hint       = pg_exception_hint,
    v_constraint = constraint_name;
  return v_state || '|' || coalesce(nullif(v_constraint, ''), '-') || '|'
    || (strpos(coalesce(v_msg, '') || ' ' || coalesce(v_detail, '') || ' ' || coalesce(v_hint, ''), marker) > 0)::text;
end;
$$;

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

-- 15. Auto-referência é recusada pelo trigger de validação, com a constraint de nome
-- clinical_records_supersedes_not_self (o trigger roda antes da FK e da checagem de existência).
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (id, tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
      values ('c7777777-7777-4777-8777-777777777771', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444442',
              'c7777777-7777-4777-8777-777777777771', 'Auto-correção', '99999999-9999-4999-8999-999999999999')
    $sql$,
    'MARCADOR_INEXISTENTE_AUTO'
  ),
  '23514|clinical_records_supersedes_not_self|false',
  'registro que aponta para si mesmo é recusado pelo trigger, com a constraint nomeada'
);

-- 16. Referência a registro ainda não inserido no mesmo statement é recusada. O primeiro registro
-- aponta para um id que, no momento da linha, ainda não existe (o segundo só entra depois), então o
-- trigger recusa antes da FK ver o segundo. Não é um ciclo testado de fato: é a recusa da referência.
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
  'referência a registro ainda não inserido no mesmo statement é recusada'
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
-- transação (rollback), e revoga logo depois. O trigger roda antes da RLS e da FK, e o resultado
-- tem que ser igual ao de um id inexistente: mesmo SQLSTATE e mesma mensagem. Com RLS sem policy, o
-- trigger não enxerga o registro de B; se o trigger fosse security definer, enxergaria e a falha
-- seria 42501. Estado com insert e sem select (42501 na leitura de existência) não é coberto aqui;
-- a ADR-06 cobre com a policy de tenant.
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
revoke select, insert on clinical_records from authenticated;

-- 24 a 27 e 30 a 33 (vazamento). Nenhum erro de conteúdo, obrigatoriedade ou cadeia pode devolver o
-- texto clínico na mensagem, no DETAIL ou no HINT. Marcador único por caso, para o teste ser exato.
-- Os testes 28 e 29 ficam no meio do bloco: são de FK de atendimento e de campo vazio, não de eco.

-- 24. tenant_id nulo com texto clínico na linha: 23502 do trigger, sem eco. Antes do trigger,
-- a linha inteira sairia no DETAIL do NOT NULL.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values (null, 'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444442',
              'DADO_CLINICO_TESTE_TENANT_NULO', '99999999-9999-4999-8999-999999999999')
    $sql$,
    'DADO_CLINICO_TESTE_TENANT_NULO'
  ),
  '23502|-|false',
  'tenant_id nulo não ecoa o texto clínico na resposta de erro'
);

-- 25. customer_id nulo com medicamentos na linha: 23502 do trigger, sem eco.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, medications, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'a4444444-4444-4444-8444-444444444442',
              'DADO_CLINICO_TESTE_CLIENTE_NULO', '99999999-9999-4999-8999-999999999999')
    $sql$,
    'DADO_CLINICO_TESTE_CLIENTE_NULO'
  ),
  '23502|-|false',
  'customer_id nulo não ecoa o medicamento na resposta de erro'
);

-- 26. Observações com 3000 caracteres, marcador no início: 23514 do trigger, sem eco.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444442',
              'DADO_CLINICO_TESTE_LIMITE' || repeat('a', 3000), '99999999-9999-4999-8999-999999999999')
    $sql$,
    'DADO_CLINICO_TESTE_LIMITE'
  ),
  '23514|clinical_records_clinical_notes_check|false',
  'observações acima do limite não ecoam o texto clínico na resposta de erro'
);

-- 27. Alergias com espaço nas pontas e marcador: a recusa de formato não ecoa o valor.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, allergies, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444442', '  DADO_CLINICO_TESTE_PADDING  ',
              '99999999-9999-4999-8999-999999999999')
    $sql$,
    'DADO_CLINICO_TESTE_PADDING'
  ),
  '23514|clinical_records_allergies_check|false',
  'alergia com espaço nas pontas não ecoa o texto clínico na resposta de erro'
);

-- 28. Registro com customer_id de outro cliente do atendimento é recusado pela FK de atendimento.
-- O atendimento 444 é do cliente A2; o registro diz A1. Não há original no 444, então o índice de
-- original único não barra antes da FK.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444444', 'Cliente de outro atendimento', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23503',
  'insert or update on table "clinical_records" violates foreign key constraint "clinical_records_appointment_fk"',
  'registro com cliente diferente do atendimento é recusado pela FK clinical_records_appointment_fk'
);

-- 29. Campo opcional vazio ('') é gravado como null, e não reprova o registro com outro campo válido.
select lives_ok(
  $sql$
    insert into clinical_records (id, tenant_id, customer_id, appointment_id, allergies, medications, created_by)
    values ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'a3333333-3333-4333-8333-333333333332', 'a4444444-4444-4444-8444-444444444444',
            '', 'Dipirona', '99999999-9999-4999-8999-999999999999')
  $sql$,
  'campo vazio com outro campo preenchido é aceito'
);

select is(
  (select allergies from clinical_records where id = 'c0000000-0000-4000-8000-000000000001'),
  null::text,
  'campo vazio é gravado como null'
);

-- 30. id nulo com texto clínico na linha: 23502 do trigger, sem eco.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (id, tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values (null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444443', 'DADO_CLINICO_TESTE_ID_NULO', '99999999-9999-4999-8999-999999999999')
    $sql$,
    'DADO_CLINICO_TESTE_ID_NULO'
  ),
  '23502|-|false',
  'id nulo não ecoa o texto clínico na resposta de erro'
);

-- 31. appointment_id nulo com texto clínico na linha: 23502 do trigger, sem eco.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', null,
              'DADO_CLINICO_TESTE_ATENDIMENTO_NULO', '99999999-9999-4999-8999-999999999999')
    $sql$,
    'DADO_CLINICO_TESTE_ATENDIMENTO_NULO'
  ),
  '23502|-|false',
  'appointment_id nulo não ecoa o texto clínico na resposta de erro'
);

-- 32. created_by nulo com texto clínico na linha: 23502 do trigger, sem eco.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444443', 'DADO_CLINICO_TESTE_AUTOR_NULO', null)
    $sql$,
    'DADO_CLINICO_TESTE_AUTOR_NULO'
  ),
  '23502|-|false',
  'created_by nulo não ecoa o texto clínico na resposta de erro'
);

-- 33. created_at nulo com texto clínico na linha: 23502 do trigger, sem eco.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by, created_at)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444443', 'DADO_CLINICO_TESTE_DATA_NULA', '99999999-9999-4999-8999-999999999999', null)
    $sql$,
    'DADO_CLINICO_TESTE_DATA_NULA'
  ),
  '23502|-|false',
  'created_at nulo não ecoa o texto clínico na resposta de erro'
);

-- 34. Campo só com U+00A0 (espaço sem quebra) é tratado como vazio: recusado pela regra de conteúdo mínimo.
select is(
  pg_temp.clinical_probe(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, allergies, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444442', E'\u00a0', '99999999-9999-4999-8999-999999999999')
    $sql$,
    'MARCADOR_INEXISTENTE_NBSP_VAZIO'
  ),
  '23514|clinical_records_has_content|false',
  'campo só com U+00A0 é recusado como vazio'
);

-- 35. Campo com U+00A0 nas pontas é recusado pela regra de formato, mesmo com texto no meio.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, medications, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444442', E'\u00a0Dipirona', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23514',
  null,
  'campo com U+00A0 nas pontas é recusado'
);

-- 36. UPDATE: alergias com 501 caracteres é recusado pelo trigger (o trigger roda em before insert or
-- update, então o caminho de UPDATE também precisa de prova).
select is(
  pg_temp.clinical_probe(
    $sql$
      update clinical_records set allergies = repeat('a', 501)
      where id = 'c5555555-5555-4555-8555-555555555551'
    $sql$,
    'MARCADOR_INEXISTENTE_UPDATE_501'
  ),
  '23514|clinical_records_allergies_check|false',
  'UPDATE de alergias acima do limite é recusado pelo trigger'
);

-- 37 e 38. UPDATE: observações como string vazia, com alergias preenchidas, grava null e não reprova.
select lives_ok(
  $sql$
    update clinical_records set allergies = 'Penicilina', clinical_notes = ''
    where id = 'c5555555-5555-4555-8555-555555555551'
  $sql$,
  'UPDATE com observações vazia e alergias preenchida é aceito'
);

select is(
  (select clinical_notes from clinical_records where id = 'c5555555-5555-4555-8555-555555555551'),
  null::text,
  'UPDATE grava observações vazia como null'
);

select * from finish();
rollback;
