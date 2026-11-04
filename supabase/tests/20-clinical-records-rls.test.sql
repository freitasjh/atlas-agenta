-- Teste de RLS de clinical_records (ADR-06), pgTAP.
-- Papéis reais: cada asserção de acesso roda como `authenticated` (ou `anon`) via
-- tests.authenticate_as, para a RLS ser avaliada de verdade. O owner só monta a fixture.
-- Fixture própria, domínio `.invalido` (guarda do harness, ADR-04). Roda numa transação e dá
-- rollback: nada persiste no banco de teste.
--
-- Prova (ADR-06, critérios 1 a 13):
--   admin lê o tenant inteiro; admin não lê outro tenant, nem com tenant_id forjado; admin do
--   tenant B não lê, não registra e não corrige no tenant A (sentido inverso);
--   profissional lê e registra só no próprio atendimento; não lê nem registra no de outro
--   profissional do mesmo cliente; profissional sem profile_id não lê nem registra; recepção e
--   super_admin não leem nem registram; anon não lê; status bloqueados recusam insert; created_by
--   e tenant_id forjados são recusados; created_at forjado é recusado; tenant bloqueado e cancelado
--   recusam insert; tenant ativo e trial aceitam insert.

create extension if not exists pgtap with schema extensions;
begin;
select plan(42);

-- ----------------------------------------------------------------------------
-- Helper local (pg_temp, some com a transação). Executa o statement e devolve SQLSTATE do erro
-- ou 'ok'. Usado só em caso que precisa comparar o código sem interromper o teste.
-- ----------------------------------------------------------------------------
create or replace function pg_temp.rls_state(stmt text)
returns text
language plpgsql
as $$
declare
  v_state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end;
$$;

-- ----------------------------------------------------------------------------
-- Usuários de app (profiles criados pelo harness). O admin cria o tenant A.
-- ----------------------------------------------------------------------------
select tests.create_user('10000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('10000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional 1');
select tests.create_user('10000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional 2');
select tests.create_user('10000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional sem vínculo');
select tests.create_user('10000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepção A');
select tests.create_user('10000000-0000-4000-8000-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');
select tests.create_user('10000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Super admin');

-- Super admin não tem tenant (invariante de profiles: só super_admin pode ter tenant_id nulo).
update profiles set role = 'super_admin', tenant_id = null
 where id = '10000000-0000-4000-8000-000000000007';

-- Tenants: clínica e ativa (o padrão do harness é trial; a assinatura muda só nos testes do fim).
update tenants set segment = 'clinica', plan = 'clinica', subscription_status = 'ativo'
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- Profissionais: 1 e 2 vinculados (profile_id); 3 sem vínculo; PB do tenant B.
insert into professionals (id, tenant_id, name, profile_id) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional 1', '10000000-0000-4000-8000-000000000002'),
  ('a1111111-1111-4111-8111-111111111112', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional 2', '10000000-0000-4000-8000-000000000003'),
  ('a1111111-1111-4111-8111-111111111113', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional sem vínculo', null),
  ('b1111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Profissional B', null);

insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A1', '+5511900000001'),
  ('a3333333-3333-4333-8333-333333333332', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A2', '+5511900000002'),
  ('b3333333-3333-4333-8333-333333333331', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cliente B1', '+5511900000003');

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Consulta A', 60, 15000),
  ('b2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Consulta B', 60, 15000);

-- Atendimentos do tenant A. Janelas por profissional sem sobreposição (constraint de conflito).
-- Ids 401..412; o status define o que a policy de insert aceita.
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status, confirmed_at) values
  ('a4444444-4444-4444-8444-444444444401', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 10:00:00+00', '2030-03-10 11:00:00+00', 15000, 'concluido', null),
  ('a4444444-4444-4444-8444-444444444402', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 13:00:00+00', '2030-03-10 14:00:00+00', 15000, 'em_atendimento', null),
  ('a4444444-4444-4444-8444-444444444403', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111112', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 15:00:00+00', '2030-03-10 16:00:00+00', 15000, 'concluido', null),
  ('a4444444-4444-4444-8444-444444444404', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 17:00:00+00', '2030-03-10 18:00:00+00', 15000, 'pendente', null),
  ('a4444444-4444-4444-8444-444444444405', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 18:00:00+00', '2030-03-10 19:00:00+00', 15000, 'confirmado', '2030-03-09 12:00:00+00'),
  ('a4444444-4444-4444-8444-444444444406', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 19:00:00+00', '2030-03-10 20:00:00+00', 15000, 'cancelado', null),
  ('a4444444-4444-4444-8444-444444444407', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 20:00:00+00', '2030-03-10 21:00:00+00', 15000, 'nao_compareceu', null),
  ('a4444444-4444-4444-8444-444444444408', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-12 10:00:00+00', '2030-03-12 11:00:00+00', 15000, 'concluido', null),
  ('a4444444-4444-4444-8444-444444444409', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-13 10:00:00+00', '2030-03-13 11:00:00+00', 15000, 'em_atendimento', null),
  ('a4444444-4444-4444-8444-444444444410', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111112', 'a2222222-2222-4222-8222-222222222222', '2030-03-13 13:00:00+00', '2030-03-13 14:00:00+00', 15000, 'em_atendimento', null),
  ('a4444444-4444-4444-8444-444444444411', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-14 10:00:00+00', '2030-03-14 11:00:00+00', 15000, 'em_atendimento', null),
  ('a4444444-4444-4444-8444-444444444412', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-15 10:00:00+00', '2030-03-15 11:00:00+00', 15000, 'concluido', null);

-- Atendimento do tenant B.
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('b4444444-4444-4444-8444-444444444401', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331', 'b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', '2030-03-11 10:00:00+00', '2030-03-11 11:00:00+00', 15000, 'concluido');

-- Registros já existentes (inseridos pelo owner, que ignora RLS). created_by é o autor.
-- R1: original do atendimento 401 (profissional 1). R2: correção de R1 no mesmo atendimento.
-- R3: original do atendimento 403 (profissional 2, mesmo cliente A1). RB: original do tenant B.
insert into clinical_records (id, tenant_id, customer_id, appointment_id, supersedes_id, allergies, clinical_notes, created_by) values
  ('c5555555-5555-4555-8555-555555555501', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444401', null, 'Dipirona', null, '10000000-0000-4000-8000-000000000002'),
  ('c5555555-5555-4555-8555-555555555502', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444401', 'c5555555-5555-4555-8555-555555555501', null, 'Correção da R1', '10000000-0000-4000-8000-000000000001'),
  ('c5555555-5555-4555-8555-555555555503', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444403', null, null, 'Observação da R3', '10000000-0000-4000-8000-000000000003'),
  ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331', 'b4444444-4444-4444-8444-444444444401', null, null, 'Original do tenant B', '10000000-0000-4000-8000-000000000006');

-- ============================================================================
-- Admin do tenant A (critérios 1, 2, 8 positivo, correção e insert).
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000001', 'authenticated');

-- 1. Admin lê todos os registros do tenant A (3).
select is(
  (select count(*)::int from clinical_records),
  3,
  'admin lê todos os registros do próprio tenant'
);

-- 2. Admin não lê registro de outro tenant, nem com tenant_id forjado na consulta.
select is(
  (select count(*)::int from clinical_records
    where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
       or id = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  0,
  'admin não lê registro de outro tenant, nem com tenant_id forjado'
);

-- 20. Admin registra original em atendimento em_atendimento de outro profissional.
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, allergies, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
            'a4444444-4444-4444-8444-444444444410', 'Penicilina', '10000000-0000-4000-8000-000000000001')
  $sql$,
  'admin registra original em atendimento em_atendimento de qualquer profissional do tenant'
);

-- 21. Admin registra correção do original R3 (mesmo atendimento e cliente).
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444403', 'c5555555-5555-4555-8555-555555555503',
            'Correção da R3', '10000000-0000-4000-8000-000000000001')
  $sql$,
  'admin registra correção de registro de outro profissional no mesmo atendimento'
);

-- 22. created_by de outro usuário é recusado (RLS de insert).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444409', 'Autor forjado', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'created_by de outro usuário é recusado'
);

-- 23. tenant_id de outro tenant é recusado (RLS de insert, antes das FKs).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331',
              'b4444444-4444-4444-8444-444444444401', 'Tenant forjado', '10000000-0000-4000-8000-000000000001')
    $sql$
  ),
  '42501',
  'tenant_id de outro tenant é recusado'
);

-- ============================================================================
-- Admin do tenant B: isolamento no sentido inverso (AC-10, AC-C9). Não lê, não registra e não
-- corrige nada do tenant A, mesmo com o tenant_id do próprio tenant na linha.
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000006', 'authenticated');

-- 31. Admin B lê só o próprio registro (RB).
select is(
  (select count(*)::int from clinical_records),
  1,
  'admin B lê só registros do próprio tenant'
);

-- 32. Admin B não lê nenhum registro do tenant A (R1, R2, R3), nem por id.
select is(
  (select count(*)::int from clinical_records
    where id in ('c5555555-5555-4555-8555-555555555501',
                 'c5555555-5555-4555-8555-555555555502',
                 'c5555555-5555-4555-8555-555555555503')),
  0,
  'admin B não lê registros do tenant A, nem por id'
);

-- 33. Admin B não registra em atendimento do tenant A (tenant e cliente próprios, atendimento alheio).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444410', 'Atendimento de outro tenant', '10000000-0000-4000-8000-000000000006')
    $sql$
  ),
  '42501',
  'admin B não registra em atendimento do tenant A'
);

-- 34. Admin B não corrige registro do tenant A (R3). O trigger não enxerga R3 sob a RLS de B e
-- responde 23503, a mesma resposta de id inexistente.
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444403', 'c5555555-5555-4555-8555-555555555503',
              'Correção de outro tenant', '10000000-0000-4000-8000-000000000006')
    $sql$
  ),
  '23503',
  'admin B não corrige registro do tenant A'
);

-- 34 (controle). Mesmo admin B, id que não existe: a resposta tem de ser a mesma de registro do tenant A.
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444403', gen_random_uuid(),
              'Correção de id inexistente', '10000000-0000-4000-8000-000000000006')
    $sql$
  ),
  '23503',
  'controle: admin B recebe a mesma resposta para id inexistente e para registro do tenant A'
);

-- ============================================================================
-- Profissional 1 (vinculado): vê e registra só no próprio atendimento.
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000002', 'authenticated');

-- 3. Profissional lê só os registros dos próprios atendimentos (R1 e R2; R3 é de outro profissional).
select is(
  (select count(*)::int from clinical_records),
  2,
  'profissional lê só registros de atendimentos próprios'
);

-- 4. Profissional não lê registro de outro profissional do mesmo cliente (R3).
select is(
  (select count(*)::int from clinical_records where id = 'c5555555-5555-4555-8555-555555555503'),
  0,
  'profissional não lê registro de outro profissional do mesmo cliente'
);

-- 5. Profissional registra original em atendimento próprio em_atendimento (402).
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, medications, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444402', 'Losartana', '10000000-0000-4000-8000-000000000002')
  $sql$,
  'profissional registra em atendimento próprio em_atendimento'
);

-- 6. Profissional registra original em atendimento próprio concluido (408).
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, medications, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444408', 'Losartana', '10000000-0000-4000-8000-000000000002')
  $sql$,
  'profissional registra em atendimento próprio concluido'
);

-- 6b a 6d. Correção pelo profissional 1 (decisão do PO: só registro de autoria própria). Três
-- fixtures, criadas pelo owner, num atendimento próprio cada (um original por atendimento):
--   409: original de autoria do profissional 1 (correção permitida);
--   413: original de autoria do admin (correção recusada);
--   414: original de autoria do profissional 2 (correção recusada).
reset role;
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444413', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-16 10:00:00+00', '2030-03-16 11:00:00+00', 15000, 'concluido'),
  ('a4444444-4444-4444-8444-444444444414', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-16 13:00:00+00', '2030-03-16 14:00:00+00', 15000, 'concluido');

insert into clinical_records (id, tenant_id, customer_id, appointment_id, clinical_notes, created_by) values
  ('c5555555-5555-4555-8555-555555555504', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a4444444-4444-4444-8444-444444444409', 'Original do profissional 1 para correção', '10000000-0000-4000-8000-000000000002'),
  ('c5555555-5555-4555-8555-555555555505', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a4444444-4444-4444-8444-444444444413', 'Original do admin no atendimento do profissional 1', '10000000-0000-4000-8000-000000000001'),
  ('c5555555-5555-4555-8555-555555555506', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332', 'a4444444-4444-4444-8444-444444444414', 'Original do profissional 2 no atendimento do profissional 1', '10000000-0000-4000-8000-000000000003');

select tests.authenticate_as('10000000-0000-4000-8000-000000000002', 'authenticated');

-- 6b. Profissional corrige o próprio original no próprio atendimento: permitido.
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
            'a4444444-4444-4444-8444-444444444409', 'c5555555-5555-4555-8555-555555555504',
            'Correção pelo profissional 1', '10000000-0000-4000-8000-000000000002')
  $sql$,
  'profissional corrige registro de autoria própria no próprio atendimento'
);

-- 6c. Profissional corrige original do admin no próprio atendimento: recusado (42501).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444413', 'c5555555-5555-4555-8555-555555555505',
              'Correção de registro do admin', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'profissional não corrige registro de admin no próprio atendimento'
);

-- 6d. Profissional corrige original de outro profissional no próprio atendimento: recusado (42501).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444414', 'c5555555-5555-4555-8555-555555555506',
              'Correção de registro de outro profissional', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'profissional não corrige registro de outro profissional no próprio atendimento'
);

-- 7. Profissional não registra em atendimento de outro profissional (410, do profissional 2).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444410', 'Atendimento de outro profissional', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'profissional não registra em atendimento de outro profissional'
);

-- 8. Profissional não corrige registro que não enxerga (R3, de outro profissional). O trigger
-- responde 23503, a mesma resposta de id inexistente, sem revelar que o registro existe.
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444403', 'c5555555-5555-4555-8555-555555555503',
              'Correção de registro alheio', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '23503',
  'profissional não corrige registro de outro profissional'
);

-- 8 (controle). Mesmo profissional, id que não existe em lugar nenhum: a resposta tem de ser a mesma
-- de registro alheio, senão o 23503 vazaria a existência do id.
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444403', gen_random_uuid(),
              'Correção de id inexistente', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '23503',
  'controle: profissional recebe a mesma resposta para id inexistente e para registro alheio'
);

-- 9 a 12. Atendimentos pendente, confirmado, cancelado e nao_compareceu recusam insert (404 a 407).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444404', 'Atendimento pendente', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'atendimento pendente recusa registro'
);

select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444405', 'Atendimento confirmado', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'atendimento confirmado recusa registro'
);

select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444406', 'Atendimento cancelado', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'atendimento cancelado recusa registro'
);

select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444407', 'Cliente não compareceu', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'atendimento nao_compareceu recusa registro'
);

-- ============================================================================
-- Profissional sem profile_id vinculado: não lê nem registra nada (PRD §5).
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000004', 'authenticated');

-- 13. Sem vínculo, a leitura volta vazia.
select is(
  (select count(*)::int from clinical_records),
  0,
  'profissional sem profile_id não lê nenhum registro'
);

-- 14. Sem vínculo, o insert é recusado (atendimento 409 é de outro profissional).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444409', 'Sem vínculo', '10000000-0000-4000-8000-000000000004')
    $sql$
  ),
  '42501',
  'profissional sem profile_id não registra'
);

-- ============================================================================
-- Recepção: sem leitura e sem escrita de conteúdo clínico (PRD §5, critério 6).
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000005', 'authenticated');

-- 15. Recepção recebe zero linhas.
select is(
  (select count(*)::int from clinical_records),
  0,
  'recepção não lê nenhum registro clínico'
);

-- 16. Recepção não registra.
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444409', 'Recepção tentando registrar', '10000000-0000-4000-8000-000000000005')
    $sql$
  ),
  '42501',
  'recepção não registra ficha'
);

-- ============================================================================
-- Super admin (sem tenant): sem caminho cross-tenant pelo cliente.
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000007', 'authenticated');

-- 17. Super admin recebe zero linhas.
select is(
  (select count(*)::int from clinical_records),
  0,
  'super_admin não lê nenhum registro clínico'
);

-- 18. Super admin não registra.
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444409', 'Super admin tentando registrar', '10000000-0000-4000-8000-000000000007')
    $sql$
  ),
  '42501',
  'super_admin não registra ficha'
);

-- ============================================================================
-- anon: sem privilégio de tabela (a leitura falha antes da RLS).
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000001', 'anon');

-- 19. anon não lê.
select is(
  pg_temp.rls_state('select 1 from clinical_records'),
  '42501',
  'anon não lê clinical_records'
);

-- ============================================================================
-- Profissional 1: created_at forjado é recusado; sem created_at grava now() (critério 13).
-- Testes de created_at rodam com a assinatura ativa, antes da fase de assinatura.
-- ============================================================================
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000002', 'authenticated');

-- 27. created_at no passado é recusado (RLS de insert).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by, created_at)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444409', 'Data retroativa', '10000000-0000-4000-8000-000000000002',
              now() - interval '1 day')
    $sql$
  ),
  '42501',
  'created_at no passado é recusado'
);

-- 28. created_at no futuro é recusado (RLS de insert).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by, created_at)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444409', 'Data futura', '10000000-0000-4000-8000-000000000002',
              now() + interval '1 day')
    $sql$
  ),
  '42501',
  'created_at no futuro é recusado'
);

-- 29. Sem created_at, o default grava now() (atendimento 412, concluido e próprio).
select lives_ok(
  $sql$
    insert into clinical_records (id, tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('c5555555-5555-4555-8555-555555555512', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'a3333333-3333-4333-8333-333333333332', 'a4444444-4444-4444-8444-444444444412',
            'Registro sem created_at', '10000000-0000-4000-8000-000000000002')
  $sql$,
  'insert sem created_at é aceito'
);

reset role;
-- 30. O registro gravado tem created_at igual a now() (leitura como owner, após o insert).
select is(
  (select created_at = now() from clinical_records where id = 'c5555555-5555-4555-8555-555555555512'),
  true,
  'insert sem created_at grava now()'
);

-- ============================================================================
-- Assinatura (critério 10 e 11). Fase final: muda o status do tenant A como owner.
-- ============================================================================

-- 24. Tenant bloqueado: admin não registra.
update tenants set subscription_status = 'bloqueado' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select tests.authenticate_as('10000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444409', 'Tenant bloqueado', '10000000-0000-4000-8000-000000000001')
    $sql$
  ),
  '42501',
  'tenant bloqueado recusa registro do admin'
);

-- 25. Tenant cancelado: admin não registra.
reset role;
update tenants set subscription_status = 'cancelado' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select tests.authenticate_as('10000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
              'a4444444-4444-4444-8444-444444444409', 'Tenant cancelado', '10000000-0000-4000-8000-000000000001')
    $sql$
  ),
  '42501',
  'tenant cancelado recusa registro do admin'
);

-- 26. Tenant trial aceita registro (o trial é assinatura válida para a ficha).
reset role;
update tenants set subscription_status = 'trial' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select tests.authenticate_as('10000000-0000-4000-8000-000000000001', 'authenticated');
select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332',
            'a4444444-4444-4444-8444-444444444411', 'Tenant em trial', '10000000-0000-4000-8000-000000000001')
  $sql$,
  'tenant trial aceita registro'
);

-- ============================================================================
-- Profissional desativado (active = false) com vínculo e atendimento próprio: sem leitura e sem
-- registro de ficha (decisão do PO, review da ADR-06). Como owner, desativa o profissional 1 e
-- reativa ao final, para o controle positivo provar que o flag é a causa.
-- ============================================================================
reset role;
update professionals set active = false where id = 'a1111111-1111-4111-8111-111111111111';
select tests.authenticate_as('10000000-0000-4000-8000-000000000002', 'authenticated');

-- 35. Profissional inativo não lê ficha do próprio atendimento (R1).
select is(
  (select count(*)::int from clinical_records where id = 'c5555555-5555-4555-8555-555555555501'),
  0,
  'profissional inativo não lê ficha do próprio atendimento'
);

-- 36. Profissional inativo não registra em atendimento próprio em_atendimento (402).
select is(
  pg_temp.rls_state(
    $sql$
      insert into clinical_records (tenant_id, customer_id, appointment_id, clinical_notes, created_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
              'a4444444-4444-4444-8444-444444444402', 'Profissional inativo', '10000000-0000-4000-8000-000000000002')
    $sql$
  ),
  '42501',
  'profissional inativo não registra ficha em atendimento próprio'
);

-- 37. Controle: com active = true de volta, o mesmo profissional volta a ler R1.
reset role;
update professionals set active = true where id = 'a1111111-1111-4111-8111-111111111111';
select tests.authenticate_as('10000000-0000-4000-8000-000000000002', 'authenticated');
select is(
  (select count(*)::int from clinical_records where id = 'c5555555-5555-4555-8555-555555555501'),
  1,
  'profissional reativado volta a ler a ficha do próprio atendimento'
);

reset role;
select * from finish();
rollback;
