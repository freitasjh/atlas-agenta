-- Prova da ADR-02: profiles aceita UPDATE só em full_name e isola o tenant na policy
-- (achado sec-profiles-role-escalation, severidade crítica).
--
-- Duas camadas, cada uma provada separadamente (PRD S-01, sem trigger):
--   1. grant de coluna e de tabela (CA-01 a CA-05, CA-09, CA-14, CA-15 a CA-17): com o grant
--      fechado, 42501 de permissão. INSERT e DELETE de tabela também ficam fechados;
--   2. policy profiles_update_self_or_admin (CA-10 a CA-12): isolamento de tenant e de linha.
--
-- Os critérios CA-xx são da ADR-02. A coluna "PRD" de cada um aponta o AC/RF correspondente
-- quando existe.
--
-- Roda com o papel real `authenticated` nos testes negativos, porque é ele que o PostgREST usa.
-- A checagem do estado final é feita como owner, depois de `reset role` e `clear_authentication`.
-- Tudo fica numa transação com rollback: nada persiste no banco de teste.

create extension if not exists pgtap with schema extensions;

begin;

select plan(36);

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

-- CA-01 (PRD AC-01): admin A tenta promover a si mesmo a super_admin.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'super_admin' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', 'permission denied for table profiles',
  'CA-01: admin não altera o próprio role para super_admin'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'admin',
  'CA-01: papel de A continua admin após a tentativa negada'
);

-- CA-02 (PRD AC-02, RF-01): admin A tenta trocar o próprio tenant_id para o tenant B.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set tenant_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', 'permission denied for table profiles',
  'CA-02: admin não altera o próprio tenant_id'
);
reset role;
select tests.clear_authentication();
select is(
  (select tenant_id from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid,
  'CA-02: tenant_id de A continua o tenant A após a tentativa negada'
);

-- CA-03 (PRD AC-03): admin A tenta promover o profissional P do próprio tenant a admin.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  '42501', 'permission denied for table profiles',
  'CA-03: admin não altera o role de um colega'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'CA-03: papel de P continua professional após a tentativa negada'
);

-- CA-04 (PRD AC-04): super admin S tenta alterar o próprio role.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '54545454-5454-4545-8545-545454545454'$$,
  '42501', 'permission denied for table profiles',
  'CA-04: super admin não altera o próprio role pelo cliente'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '54545454-5454-4545-8545-545454545454'),
  'super_admin',
  'CA-04: papel de S continua super_admin após a tentativa negada'
);

-- CA-05: admin A tenta rebaixar Q, super_admin do próprio tenant, para admin.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '55555555-5555-4555-8555-555555555555'$$,
  '42501', 'permission denied for table profiles',
  'CA-05: admin não rebaixa super_admin do próprio tenant'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '55555555-5555-4555-8555-555555555555'),
  'super_admin',
  'CA-05: papel de Q continua super_admin após a tentativa negada'
);

-- CA-06 (PRD AC-09, RF-07): admin A atualiza o próprio full_name (coluna permitida).
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Ana Administradora' where id = '51515151-5151-4515-8515-515151515151'$$,
  'CA-06: admin atualiza o próprio full_name'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'Ana Administradora',
  'CA-06: full_name de A gravado'
);

-- CA-07 (PRD RF-07): profissional P atualiza o próprio full_name.
select tests.authenticate_as('52525252-5252-4525-8525-525252525252', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Paulo Atualizado' where id = '52525252-5252-4525-8525-525252525252'$$,
  'CA-07: profissional atualiza o próprio full_name'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'Paulo Atualizado',
  'CA-07: full_name de P gravado'
);

-- CA-08 (decisão 1c): admin edita full_name de colega do próprio tenant, inclusive de super_admin
-- colega (a master permitia; o WITH CHECK não enxerga papel, então a policy não bloqueia).
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Paulo Editado pelo Admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  'CA-08: admin atualiza full_name de colega do próprio tenant'
);
select lives_ok(
  $$update profiles set full_name = 'Quentin Editado pelo Admin' where id = '55555555-5555-4555-8555-555555555555'$$,
  'CA-08: admin atualiza full_name de super_admin colega do próprio tenant'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'Paulo Editado pelo Admin',
  'CA-08: full_name do colega gravado pelo admin'
);
select is(
  (select full_name from profiles where id = '55555555-5555-4555-8555-555555555555'),
  'Quentin Editado pelo Admin',
  'CA-08: full_name de Q gravado pelo admin'
);

-- CA-09 (decisão 3b): super admin S tenta alterar o role de P pelo cliente. O grant fechado
-- recusa, porque a troca de papel fica para Edge Function com service role (PRD S-06).
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$update profiles set role = 'admin' where id = '52525252-5252-4525-8525-525252525252'$$,
  '42501', 'permission denied for table profiles',
  'CA-09: super_admin não altera o role de colega pelo cliente'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'CA-09: papel de P continua professional após a tentativa de super_admin'
);

-- CA-10 (isolamento entre tenants, RNF03): admin B (tenant B) tenta alterar full_name do admin
-- A (tenant A). A policy filtra a linha: 0 linhas afetadas, sem erro. Owner confirma o valor.
select tests.authenticate_as('53535353-5353-4535-8535-535353535353', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Invadido pelo Tenant B' where id = '51515151-5151-4515-8515-515151515151'$$,
  'CA-10: admin de outro tenant não grava full_name de A (sem erro, 0 linhas)'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'Ana Administradora',
  'CA-10: full_name de A continua o mesmo após a tentativa do tenant B'
);

-- CA-11 (RBAC, RF-02): profissional P tenta alterar full_name do admin A, do mesmo tenant. A
-- policy não dá ao profissional linha alheia: 0 linhas, sem erro. Owner confirma o valor.
select tests.authenticate_as('52525252-5252-4525-8525-525252525252', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Paulo Tentando Editar Admin' where id = '51515151-5151-4515-8515-515151515151'$$,
  'CA-11: profissional não grava full_name de outro usuário (sem erro, 0 linhas)'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'Ana Administradora',
  'CA-11: full_name de A continua o mesmo após a tentativa de P'
);

-- CA-12 (ADR-02 WITH CHECK, RF-01): só a policy barra a troca de tenant. Reabre o grant de
-- tenant_id de propósito, para isolar a policy. Admin A troca o próprio tenant_id para B: 42501
-- da policy, valor inalterado.
grant update (tenant_id) on table public.profiles to authenticated;

select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update profiles set tenant_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1' where id = '51515151-5151-4515-8515-515151515151'$$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'CA-12: WITH CHECK barra admin que troca o próprio tenant_id'
);
reset role;
select tests.clear_authentication();
select is(
  (select tenant_id from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid,
  'CA-12: tenant_id de A continua o tenant A com o grant reaberto'
);

revoke update (tenant_id) on table public.profiles from authenticated;

-- CA-13 (catálogo): a policy de UPDATE existe com o nome esperado.
select ok(
  exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'profiles_update_self_or_admin'
       and cmd = 'UPDATE'
  ),
  'CA-13: policy profiles_update_self_or_admin existe para UPDATE'
);

-- CA-14 (catálogo, guarda do grant): o grant de coluna é a única barreira de role, tenant_id e
-- id. authenticated só pode gravar full_name. Se alguém reabrir o grant, este teste cai.
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'tenant_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'),
  'CA-14: authenticated grava só full_name em profiles (role, tenant_id e id sem UPDATE)'
);

-- CA-15 (PRD AC-04, RF-01): super admin S tenta apagar a linha do profissional P, para depois
-- reinseri-la com outro papel ou tenant. Sem o DELETE de tabela, a policy profiles_super_admin
-- (FOR ALL) não é suficiente: 42501 de permissão, e a linha de P continua.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$delete from profiles where id = '52525252-5252-4525-8525-525252525252'$$,
  '42501', 'permission denied for table profiles',
  'CA-15: super_admin não apaga profile pelo cliente'
);
reset role;
select tests.clear_authentication();
select is(
  (select role from profiles where id = '52525252-5252-4525-8525-525252525252'),
  'professional',
  'CA-15: linha de P continua existindo com papel professional após a tentativa negada'
);

-- CA-16 (PRD AC-04, RF-01): super admin S tenta inserir um profile com papel admin no tenant A.
-- Sem o INSERT de tabela, 42501 de permissão, e nenhuma linha nova aparece.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$insert into profiles (id, tenant_id, role) values ('56565656-5656-4565-8565-565656565656', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'admin')$$,
  '42501', 'permission denied for table profiles',
  'CA-16: super_admin não insere profile pelo cliente'
);
reset role;
select tests.clear_authentication();
select is(
  (select count(*)::int from profiles where id = '56565656-5656-4565-8565-565656565656'),
  0,
  'CA-16: nenhuma linha inserida após a tentativa negada'
);

-- CA-17 (catálogo, guarda do grant de tabela): authenticated não tem INSERT, DELETE, UPDATE, TRIGGER
-- nem REFERENCES de tabela em profiles, e anon não tem TRIGGER nem REFERENCES. Se alguém reabrir
-- qualquer um deles, este teste cai. TRIGGER permitiria anexar um trigger que quebra todo UPDATE.
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'DELETE')
  and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')
  and not has_table_privilege('authenticated', 'public.profiles', 'REFERENCES')
  and not has_table_privilege('anon', 'public.profiles', 'TRIGGER')
  and not has_table_privilege('anon', 'public.profiles', 'REFERENCES'),
  'CA-17: authenticated sem INSERT, DELETE, UPDATE, TRIGGER e REFERENCES; anon sem TRIGGER e REFERENCES em profiles'
);

-- CA-18 (decisão humana, PRD §4.1 e S-06): super admin S (tenant C) tenta gravar full_name do admin
-- A (tenant A) pelo cliente. A policy profiles_super_admin é só SELECT, e a policy de UPDATE filtra
-- a linha: 0 linhas afetadas, sem erro. O teste usa lives_ok (o UPDATE não dá erro) e, em seguida,
-- confirma como owner que o valor de A não mudou.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select lives_ok(
  $$update profiles set full_name = 'Invadido pelo Super Admin' where id = '51515151-5151-4515-8515-515151515151'$$,
  'CA-18: super_admin de outro tenant não grava full_name de A (sem erro, 0 linhas)'
);
reset role;
select tests.clear_authentication();
select is(
  (select full_name from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'Ana Administradora',
  'CA-18: full_name de A continua o mesmo após a tentativa do super_admin'
);

-- CA-19 (leitura cross-tenant mantida): a policy profiles_super_admin (SELECT) continua dando ao
-- super admin S a leitura do profile do admin A, de outro tenant.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select is(
  (select full_name from profiles where id = '51515151-5151-4515-8515-515151515151'),
  'Ana Administradora',
  'CA-19: super_admin lê o profile de outro tenant (leitura cross-tenant mantida)'
);
reset role;
select tests.clear_authentication();

select * from finish();

rollback;
