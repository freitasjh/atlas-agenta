-- Prova da ADR-03: tenants aceita UPDATE só em colunas cadastrais; status e plano ficam protegidos
-- (achado de bypass de assinatura, PRD RF-03 a RF-06 e RF-11).
--
-- Fronteira por coluna (PRD S-02): authenticated grava trade_name, legal_name, phone, document e
-- timezone. Qualquer outra coluna (subscription_status, plan, trial_ends_at, segment, owner_email,
-- id) recebe 42501 de permissão antes de a policy ser avaliada. INSERT e DELETE de tabela também
-- saem de authenticated (review da ADR-03): o super admin não apaga e recria a empresa pelo cliente.
-- As policies de tenants não mudam.
--
-- Os negativos rodam com o papel real `authenticated`, porque é ele que o PostgREST usa. A checagem
-- do estado final é feita como owner, depois de `reset role` e `clear_authentication`. Tudo fica
-- numa transação com rollback: nada persiste no banco de teste.
--
-- Como a PK é `id`, cada UPDATE que grava valor afeta exatamente 1 linha. Nos casos de 0 linha
-- (recepção e profissional), o bloco `do` roda o UPDATE, lê `row_count` com `get diagnostics` e
-- levanta erro se não for 0. Admin de outro tenant (RNF03) continua provado por valor inalterado.
create extension if not exists pgtap with schema extensions;

begin;

select plan(37);

-- Fixture (domínio .invalido, conforme o harness):
--   tenant A: admin A, profissional P e recepção R
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
  '58585858-5858-4585-8585-585858585858',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'receptionist',
  'Rita Recepcao'
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

-- Valores de partida do tenant A, gravados como owner. trial_ends_at é fixo para o teste comparar.
update tenants
   set trade_name = 'Empresa A original',
       trial_ends_at = '2030-01-15 12:00:00+00'
 where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

-- AC-05 (PRD RF-04): admin A, com empresa em trial, tenta pôr o status em ativo.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update tenants set subscription_status = 'ativo' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  '42501', 'permission denied for table tenants',
  'AC-05: admin não passa a empresa de trial para ativo'
);
reset role;
select tests.clear_authentication();
select is(
  (select subscription_status from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'trial',
  'AC-05: status continua trial após a tentativa negada'
);

-- AC-06 (PRD RF-04): admin A tenta trocar plano e zerar trial_ends_at.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update tenants set plan = 'pro', trial_ends_at = null where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  '42501', 'permission denied for table tenants',
  'AC-06: admin não altera plan nem trial_ends_at'
);
reset role;
select tests.clear_authentication();
select is(
  (select plan from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'individual',
  'AC-06: plano continua individual após a tentativa negada'
);
select is(
  (select trial_ends_at from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  '2030-01-15 12:00:00+00'::timestamptz,
  'AC-06: trial_ends_at não muda após a tentativa negada'
);

-- AC-07 (PRD RF-04): segment e owner_email são recusados pelo grant, antes de avaliar o valor.
-- A expressão `coluna = coluna` evita depender de valor válido de domínio.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$update tenants set segment = segment where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  '42501', 'permission denied for table tenants',
  'AC-07: admin não grava segment'
);
select throws_ok(
  $$update tenants set owner_email = owner_email where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  '42501', 'permission denied for table tenants',
  'AC-07: admin não grava owner_email'
);
reset role;
select tests.clear_authentication();
select is(
  (select segment from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  null::text,
  'AC-07: segment continua sem valor após a tentativa negada'
);
select is(
  (select owner_email from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'tenant-a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1@teste.invalido',
  'AC-07: owner_email não muda após a tentativa negada'
);

-- AC-08 (PRD RF-05): recepção e profissional não recebem erro, mas não alteram a empresa.
select tests.authenticate_as('58585858-5858-4585-8585-585858585858', 'authenticated');
select lives_ok(
  $$do $body$
  declare
    n integer;
  begin
    update tenants set trade_name = 'Tentativa da recepcao' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
    get diagnostics n = row_count;
    if n <> 0 then
      raise exception 'UPDATE afetou % linha(s), esperado 0', n;
    end if;
  end
  $body$
  $$,
  'AC-08: recepção não recebe erro e nenhuma linha é afetada ao gravar tenants'
);
reset role;
select tests.clear_authentication();
select is(
  (select trade_name from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Empresa A original',
  'AC-08: recepção não altera trade_name'
);

select tests.authenticate_as('52525252-5252-4525-8525-525252525252', 'authenticated');
select lives_ok(
  $$do $body$
  declare
    n integer;
  begin
    update tenants set trade_name = 'Tentativa do profissional' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
    get diagnostics n = row_count;
    if n <> 0 then
      raise exception 'UPDATE afetou % linha(s), esperado 0', n;
    end if;
  end
  $body$
  $$,
  'AC-08: profissional não recebe erro e nenhuma linha é afetada ao gravar tenants'
);
reset role;
select tests.clear_authentication();
select is(
  (select trade_name from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Empresa A original',
  'AC-08: profissional não altera trade_name'
);

-- AC-10 (PRD RF-03): admin A grava as cinco colunas cadastrais da própria empresa.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select lives_ok(
  $$update tenants
       set legal_name = 'Razao Social A',
           trade_name = 'Nome Fantasia A',
           phone = '+5511999990000',
           document = '11222333000181',
           timezone = 'America/Fortaleza'
     where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  'AC-10: admin grava as colunas cadastrais da própria empresa'
);
reset role;
select tests.clear_authentication();
select is(
  (select legal_name from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Razao Social A',
  'AC-10: legal_name gravado'
);
select is(
  (select trade_name from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Nome Fantasia A',
  'AC-10: trade_name gravado'
);
select is(
  (select phone from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  '+5511999990000',
  'AC-10: phone gravado'
);
select is(
  (select document from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  '11222333000181',
  'AC-10: document gravado'
);
select is(
  (select timezone from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'America/Fortaleza',
  'AC-10: timezone gravado'
);

-- RNF03: admin B, de outro tenant, não altera a empresa A. Não há erro, e o valor não muda.
select tests.authenticate_as('53535353-5353-4535-8535-535353535353', 'authenticated');
select lives_ok(
  $$update tenants set trade_name = 'Tentativa do admin B' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  'RNF03: admin de outro tenant não recebe erro ao tentar gravar a empresa A'
);
reset role;
select tests.clear_authentication();
select is(
  (select trade_name from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Nome Fantasia A',
  'RNF03: trade_name do tenant A não muda pelo admin B'
);

-- AC-11 (PRD RF-06): super admin S não troca o status pelo cliente, mas grava cadastro de qualquer
-- tenant.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$update tenants set subscription_status = 'ativo' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  '42501', 'permission denied for table tenants',
  'AC-11: super admin não troca subscription_status pelo cliente'
);
select lives_ok(
  $$update tenants set trade_name = 'Nome cadastrado pelo super admin' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  'AC-11: super admin grava trade_name do tenant A'
);
reset role;
select tests.clear_authentication();
select is(
  (select subscription_status from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'trial',
  'AC-11: status do tenant A continua trial'
);
select is(
  (select trade_name from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Nome cadastrado pelo super admin',
  'AC-11: trade_name do tenant A gravado pelo super admin'
);

-- Bypass por DELETE e INSERT (review da ADR-03): sem o revoke de INSERT e DELETE, o super admin
-- apagava a empresa e a recriava com status ativo e plano pro. Com o revoke, os quatro casos dão
-- 42501 de permissão antes da policy, e a empresa A continua como estava.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select throws_ok(
  $$insert into tenants (id, legal_name, owner_email, subscription_status, plan)
    values ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'Empresa injetada', 'injetada@teste.invalido', 'ativo', 'pro')$$,
  '42501', 'permission denied for table tenants',
  'INSERT: super admin não cria empresa pelo cliente'
);
select throws_ok(
  $$delete from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  '42501', 'permission denied for table tenants',
  'DELETE: super admin não apaga empresa pelo cliente'
);
reset role;
select tests.clear_authentication();

select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$insert into tenants (id, legal_name, owner_email) values ('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'Empresa do admin', 'admin-injetado@teste.invalido')$$,
  '42501', 'permission denied for table tenants',
  'INSERT: admin não cria empresa pelo cliente'
);
select throws_ok(
  $$delete from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'$$,
  '42501', 'permission denied for table tenants',
  'DELETE: admin não apaga a própria empresa pelo cliente'
);
reset role;
select tests.clear_authentication();

select is(
  (select count(*)::int from tenants where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  1,
  'DELETE: empresa A continua existindo após as tentativas negadas'
);
select is(
  (select count(*)::int from tenants where id in ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2')),
  0,
  'INSERT: nenhuma empresa nova criada pelas tentativas negadas'
);

-- AC-12 (PRD RF-11): signup pelo trigger handle_new_user, como owner. O trigger roda como
-- security definer e não depende do grant de authenticated. Cria empresa em trial e profile admin.
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values (
  '57575757-5757-4575-8575-575757575757',
  'authenticated',
  'authenticated',
  'signup-tenants@teste.invalido',
  '{"trade_name": "Salao Signup Teste", "full_name": "Sofia Signup"}'::jsonb
);
select is(
  (select p.role from profiles p where p.id = '57575757-5757-4575-8575-575757575757'),
  'admin',
  'AC-12: signup cria profile com role admin'
);
select is(
  (select t.subscription_status
     from profiles p
     join tenants t on t.id = p.tenant_id
    where p.id = '57575757-5757-4575-8575-575757575757'),
  'trial',
  'AC-12: empresa do signup nasce em trial'
);
select ok(
  (select t.trial_ends_at between now() + interval '13 days' and now() + interval '15 days'
     from profiles p
     join tenants t on t.id = p.tenant_id
    where p.id = '57575757-5757-4575-8575-575757575757'),
  'AC-12: trial_ends_at fica em cerca de 14 dias'
);
select is(
  (select t.trade_name
     from profiles p
     join tenants t on t.id = p.tenant_id
    where p.id = '57575757-5757-4575-8575-575757575757'),
  'Salao Signup Teste',
  'AC-12: trade_name vem do metadado de signup'
);

-- Guarda de catálogo (PRD S-02): o conjunto de colunas de tenants com UPDATE para authenticated é
-- exatamente a lista cadastral. Qualquer coluna nova ou reaberta falha este teste.
select is(
  (select string_agg(attname::text, ',' order by attname)
     from pg_attribute
    where attrelid = 'public.tenants'::regclass
      and attnum > 0
      and not attisdropped
      and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')),
  'document,legal_name,phone,timezone,trade_name',
  'guarda de catálogo: authenticated tem UPDATE só nas colunas cadastrais de tenants'
);

-- Guarda de catálogo (review da ADR-03): authenticated não tem INSERT nem DELETE de tabela em
-- tenants. Se alguém reabrir um dos dois, este teste cai.
select ok(
  not has_table_privilege('authenticated', 'public.tenants', 'INSERT')
  and not has_table_privilege('authenticated', 'public.tenants', 'DELETE'),
  'guarda de catálogo: authenticated sem INSERT nem DELETE de tabela em tenants'
);

select * from finish();
rollback;
