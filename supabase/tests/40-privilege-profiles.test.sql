-- Prova da ADR-02: profiles aceita UPDATE só em full_name e tem barreira contra promoção
-- a super_admin (achado sec-profiles-role-escalation, severidade crítica).
--
-- Roda com o papel real `authenticated` nos testes negativos, porque é ele que o PostgREST usa.
-- A checagem do estado final é feita como owner, depois de `reset role` e `clear_authentication`.
-- Tudo fica numa transação com rollback: nada persiste no banco de teste.

create extension if not exists pgtap with schema extensions;

begin;

select plan(21);

-- Fixture (domínio .invalido, conforme o harness):
--   tenant A: admin A e profissional P
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

-- AC-01: admin A tenta promover a si mesmo a super_admin.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'super_admin' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', null,
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
  '42501', null,
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
  '42501', null,
  'AC-03: admin não altera o role de um colega'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'AC-03: papel de P continua professional após a tentativa negada'
);

-- AC-04: super admin S tenta alterar o próprio role.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '54545454-5454-4545-8545-545454545454'$$,
  '42501', null,
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

-- ADR-02 AC-06 (comportamento): a barreira do WITH CHECK só age se o grant de coluna estiver
-- reaberto, porque sem ele o motor barra antes da policy. Por isso o teste reabre
-- grant update (role, tenant_id) para authenticated dentro desta transação e fecha de novo no fim.
grant update (role, tenant_id) on table public.profiles to authenticated;

-- Admin A tenta promover a si mesmo a super_admin: 42501 vem da policy (WITH CHECK).
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'super_admin' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', null,
  'ADR-02 AC-06: WITH CHECK barra admin que grava super_admin na própria linha'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'admin',
  'ADR-02 AC-06: papel de A continua admin com o grant reaberto'
);

-- Admin A tenta trocar o próprio tenant_id para o tenant B: 42501 vem da policy.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set tenant_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', null,
  'ADR-02 AC-06: WITH CHECK barra admin que troca o próprio tenant_id'
);
reset role;
select tests.clear_authentication();
select is(
  (select tenant_id from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid,
  'ADR-02 AC-06: tenant_id de A continua o tenant A com o grant reaberto'
);

-- RF-02 com colega: admin A tenta gravar super_admin na linha do profissional P do próprio tenant.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'super_admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  '42501', null,
  'ADR-02 AC-06: WITH CHECK barra admin que promove colega a super_admin'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'ADR-02 AC-06: papel de P continua professional com o grant reaberto'
);

revoke update (role, tenant_id) on table public.profiles from authenticated;

-- ADR-02 AC-06 (catálogo, complemento): a barreira do WITH CHECK aparece em pg_policies.
-- Não prova a regra sozinho: um with_check que só cite super_admin também passaria.
select ok(
  exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'profiles_update_self_or_admin'
       and with_check like '%super_admin%'
  ),
  'ADR-02 AC-06: with_check de profiles_update_self_or_admin cita super_admin'
);

select * from finish();

rollback;
