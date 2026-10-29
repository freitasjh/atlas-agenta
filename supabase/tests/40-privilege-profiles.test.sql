-- Prova da ADR-02: profiles aceita UPDATE só em full_name e tem barreiras contra escalada de
-- papel e de tenant (achado sec-profiles-role-escalation, severidade crítica).
--
-- Três camadas, cada uma provada separadamente:
--   1. grant de coluna (testes AC-01 a AC-04 e AC-03b, com o grant fechado): 42501 de permissão;
--   2. trigger profiles_guard_role_tenant (seção de regressão, com o grant reaberto): 42501 da
--      função com mensagem fixa. É a barreira de papel, inclusive contra super_admin;
--   3. policy profiles_update_self_or_admin (bloco de tenant, com o grant reaberto e o trigger
--      desligado de propósito): 42501 da policy. Barra escrita em outro tenant.
--
-- Roda com o papel real `authenticated` nos testes negativos, porque é ele que o PostgREST usa.
-- A checagem do estado final é feita como owner, depois de `reset role` e `clear_authentication`.
-- Tudo fica numa transação com rollback: nada persiste no banco de teste.

create extension if not exists pgtap with schema extensions;

begin;

select plan(30);

-- Fixture (domínio .invalido, conforme o harness):
--   tenant A: admin A, profissional P e super admin Q (role super_admin dentro do tenant A)
--   tenant B: admin B
--   tenant C: super admin S
select tests.create_user(
  '51515151-5151-4515-8515-515151515151',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'admin',
  'Ana Admin'
);
select tests.create_user(
  '52525252-5252-4525-8525-525252525252',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'professional',
  'Paulo Profissional'
);
select tests.create_user(
  '53535353-5353-4535-8535-535353535353',
  'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1',
  'admin',
  'Bruno Admin'
);
select tests.create_user(
  '54545454-5454-4545-8545-545454545454',
  'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
  'super_admin',
  'Sofia Super'
);
select tests.create_user(
  '55555555-5555-4555-8555-555555555555',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'super_admin',
  'Quentin Super Tenant A'
);

-- AC-01: admin A tenta promover a si mesmo a super_admin.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'super_admin' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', 'permission denied for table profiles',
  'AC-01: admin não altera o próprio role para super_admin'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'admin',
  'AC-01: papel de A continua admin após a tentativa negada'
);

-- AC-02: admin A tenta trocar o próprio tenant_id para o tenant B.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set tenant_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', 'permission denied for table profiles',
  'AC-02: admin não altera o próprio tenant_id'
);
reset role;
select tests.clear_authentication();
select is(
  (select tenant_id from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid,
  'AC-02: tenant_id de A continua o tenant A após a tentativa negada'
);

-- AC-03: admin A tenta promover o profissional P do próprio tenant a admin.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  '42501', 'permission denied for table profiles',
  'AC-03: admin não altera o role de um colega'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'AC-03: papel de P continua professional após a tentativa negada'
);

-- AC-03b: admin A tenta rebaixar Q, super_admin do próprio tenant, para admin.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '55555555-5555-4555-8555-555555555555'$$,
  '42501', 'permission denied for table profiles',
  'AC-03b: admin não rebaixa super_admin do próprio tenant'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '55555555-5555-4555-8555-555555555555'),
  'super_admin',
  'AC-03b: papel de Q continua super_admin após a tentativa negada'
);

-- AC-04: super admin S tenta alterar o próprio role.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '54545454-5454-4545-8545-545454545454'$$,
  '42501', 'permission denied for table profiles',
  'AC-04: super admin não altera o próprio role pelo cliente'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '54545454-5454-4545-8545-545454545454'),
  'super_admin',
  'AC-04: papel de S continua super_admin após a tentativa negada'
);

-- AC-09: admin A atualiza o próprio full_name (coluna permitida). O valor gravado abaixo
-- prova que a linha foi afetada.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Ana Administradora' where id = '51515151-5151-4515-8515-515151515151'$$,
  'AC-09: admin atualiza o próprio full_name'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'Ana Administradora',
  'AC-09: full_name de A gravado'
);

-- RF-07: profissional P atualiza o próprio full_name: 1 linha.
select tests.authenticate_as('52525252-5252-4525-8525-525252525252', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Paulo Atualizado' where id = '52525252-5252-4525-8525-525252525252'$$,
  'RF-07: profissional atualiza o próprio full_name'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'Paulo Atualizado',
  'RF-07: full_name de P gravado'
);

-- Consequência da ADR: admin edita full_name de colega do próprio tenant.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Paulo Editado pelo Admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  'admin atualiza full_name de colega do próprio tenant'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'Paulo Editado pelo Admin',
  'full_name do colega gravado pelo admin'
);

-- Regressão do review (decisão 1c): admin edita full_name de super_admin colega do próprio
-- tenant. A master permitia; a ADR mantém (o WITH CHECK não cuida de papel).
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Quentin Editado pelo Admin' where id = '55555555-5555-4555-8555-555555555555'$$,
  'admin atualiza full_name de super_admin colega do próprio tenant'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '55555555-5555-4555-8555-555555555555'),
  'Quentin Editado pelo Admin',
  'full_name de Q gravado pelo admin'
);

-- ADR-02 AC-06 (tenant, policy isolada): reabre grant update (role, tenant_id) e desliga o
-- trigger profiles_guard_role_tenant, para que só a policy barre a troca de tenant.
grant update (role, tenant_id) on table public.profiles to authenticated;
alter table public.profiles disable trigger profiles_guard_role_tenant;

-- Admin A tenta trocar o próprio tenant_id para o tenant B: 42501 vem da policy.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set tenant_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'ADR-02 AC-06: WITH CHECK barra admin que troca o próprio tenant_id'
);
reset role;
select tests.clear_authentication();
select is(
  (select tenant_id from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid,
  'ADR-02 AC-06: tenant_id de A continua o tenant A com o grant reaberto'
);

alter table public.profiles enable trigger profiles_guard_role_tenant;

-- Regressão (trigger, grant de role reaberto e trigger ativo): a camada 2 barra admin que
-- promove a si mesmo, promove colega ou rebaixa super_admin do próprio tenant. A policy não
-- enxerga OLD.role, por isso só o trigger cobre essas três escritas.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'super_admin' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', 'alteração de papel ou de empresa não permitida para este usuário',
  'REG-trigger: admin não promove a si mesmo a super_admin com o grant reaberto'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'admin',
  'REG-trigger: papel de A continua admin após a barreira do trigger'
);

select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  '42501', 'alteração de papel ou de empresa não permitida para este usuário',
  'REG-trigger: admin não promove colega a admin com o grant reaberto'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'REG-trigger: papel de P continua professional após a barreira do trigger'
);

select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '55555555-5555-4555-8555-555555555555'$$,
  '42501', 'alteração de papel ou de empresa não permitida para este usuário',
  'REG-trigger: admin não rebaixa super_admin do próprio tenant com o grant reaberto'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '55555555-5555-4555-8555-555555555555'),
  'super_admin',
  'REG-trigger: papel de Q continua super_admin após a barreira do trigger'
);

-- Decisão 3b: super admin S também não altera role de outro usuário pelo cliente, mesmo com
-- o grant reaberto. A troca de papel fica para Edge Function com service role (PRD §4.3, S-01).
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  '42501', 'alteração de papel ou de empresa não permitida para este usuário',
  'REG-trigger: super_admin não altera o role de colega pelo cliente'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'REG-trigger: papel de P continua professional após a tentativa de super_admin'
);

revoke update (role, tenant_id) on table public.profiles from authenticated;

-- ADR-02 AC-06 (catálogo, complemento): a policy de UPDATE existe com o nome esperado.
select ok(
  exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'profiles_update_self_or_admin'
       and cmd = 'UPDATE'
  ),
  'ADR-02 AC-06: policy profiles_update_self_or_admin existe para UPDATE'
);

-- Catálogo do trigger: existe, ativo e não interno.
select ok(
  exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'profiles_guard_role_tenant'
       and tgenabled = 'O'
       and not tgisinternal
  ),
  'ADR-02: trigger profiles_guard_role_tenant ativo em profiles'
);

select * from finish();

rollback;
