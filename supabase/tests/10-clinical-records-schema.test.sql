-- Teste de schema de clinical_records (ADR-05), pgTAP.
-- Roda como owner da sessão (`supabase test db`), por isso não prova RLS de acesso: isso é da
-- ADR-06. Prova constraints, índices e FKs compostas: conteúdo mínimo, limites, unicidade de
-- original e de correção, e amarração de tenant, atendimento e cliente.
-- Fixture própria, domínio `.invalido` (guarda do harness, ADR-04). Roda numa transação e dá
-- rollback: nada persiste no banco de teste.
create extension if not exists pgtap with schema extensions;
begin;
select plan(14);

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
  ('a4444444-4444-4444-8444-444444444443', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 15:00:00+00', '2030-03-10 16:00:00+00', 15000);

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

-- 12. Correção com cliente diferente do atendimento é recusada. Aponta para a correção 10
-- (sem sucessora), para que a falha venha da FK e não do índice de correção única.
select throws_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
            'a4444444-4444-4444-8444-444444444441', 'c6666666-6666-4666-8666-666666666661',
            'Correção com outro cliente', '99999999-9999-4999-8999-999999999999')
  $sql$,
  '23503',
  null,
  'correção com customer_id de outro cliente do atendimento é recusada'
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

select * from finish();
rollback;
