-- Smoke test do harness (ADR-04).
-- Prova que os helpers de autenticação e as funções current_tenant_id() / current_role_name()
-- devolvem o tenant e o papel do usuário autenticado, e que a RLS de tenants separa empresas.
-- Os helpers são chamados como owner; a troca de papel é desfeita com `reset role` antes de
-- cada nova chamada. Roda numa transação e dá rollback: nada persiste no banco de teste.

create extension if not exists pgtap with schema extensions;

begin;

select plan(6);

-- Fixture: duas empresas, um usuário em cada uma.
select tests.create_user(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'admin',
  'Ana Admin'
);
select tests.create_user(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'receptionist',
  'Bia Recepção'
);

-- Usuário A autenticado como authenticated.
select tests.authenticate_as('11111111-1111-4111-8111-111111111111', 'authenticated');

select is(
  current_tenant_id(),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'current_tenant_id() devolve o tenant do usuário A'
);

select is(
  current_role_name(),
  'admin',
  'current_role_name() devolve o papel do usuário A'
);

select is(
  (select count(*) from tenants where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid),
  0::bigint,
  'usuário A não enxerga a empresa B pela RLS de tenants'
);

-- Volta ao owner, limpa as claims e troca para o usuário B: as funções precisam acompanhar
-- a claim, não ficar fixas.
reset role;
select tests.clear_authentication();
select tests.authenticate_as('22222222-2222-4222-8222-222222222222', 'authenticated');

select is(
  current_tenant_id(),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'current_tenant_id() acompanha a claim e devolve o tenant do usuário B'
);

select is(
  current_role_name(),
  'receptionist',
  'current_role_name() acompanha a claim e devolve o papel do usuário B'
);

-- Volta ao owner: clear_authentication() precisa restaurar o papel da sessão.
reset role;
select tests.clear_authentication();

select is(
  current_user::text,
  session_user::text,
  'clear_authentication() volta ao owner da sessão'
);

select * from finish();

rollback;
