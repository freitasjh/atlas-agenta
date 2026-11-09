-- Freeze de super_admin com greenfield (code-review internal-operators-mfa, 🔴 C2/C3).
--
--  C2. Trigger `profiles_freeze_super_admin` libera o PRIMEIRO super_admin
--      (tabela `internal_operators` vazia = bootstrap greenfield) e barra com
--      42501 quando já existe ≥1 operador. O handler `bootstrap-super-admin`
--      espelha a mesma regra (vazia → cria; ≥1 → 403 bootstrap_bloqueado).
--  C3. `freeze_super_admin_role()` sem EXECUTE para anon/authenticated
--      (deny-all, só service_role/owner executam via trigger).
--
-- Padrão do harness (00-helpers.sql): negativos com o papel real
-- `authenticated` via tests.authenticate_as; tudo em transação com rollback.
create extension if not exists pgtap with schema extensions;

begin;

select plan(8);

-- C3 (catálogo): função do freeze sem EXECUTE para cliente.
select ok(
  not has_function_privilege('anon', 'public.freeze_super_admin_role()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.freeze_super_admin_role()', 'EXECUTE'),
  'C3: anon e authenticated sem EXECUTE em freeze_super_admin_role'
);

-- deny-all (catálogo): tabela de operadores sem SELECT para cliente.
select ok(
  not has_table_privilege('anon', 'public.internal_operators', 'SELECT')
  and not has_table_privilege('authenticated', 'public.internal_operators', 'SELECT'),
  'deny-all: anon e authenticated sem SELECT em internal_operators'
);

-- deny-all (catálogo): helper sem EXECUTE para cliente (só service_role/owner).
select ok(
  not has_function_privilege('anon', 'public.is_internal_operator()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.is_internal_operator()', 'EXECUTE'),
  'deny-all: anon e authenticated sem EXECUTE em is_internal_operator'
);

-- deny-all (catálogo): auditoria sem SELECT para cliente.
select ok(
  not has_table_privilege('anon', 'public.internal_operator_audit', 'SELECT')
  and not has_table_privilege('authenticated', 'public.internal_operator_audit', 'SELECT'),
  'deny-all: anon e authenticated sem SELECT em internal_operator_audit'
);

-- Greenfield: esvazia operadores (owner) para provar o bootstrap inicial.
delete from public.internal_operators;

-- C2 (vazia permite): primeiro super_admin nasce livre (bootstrap greenfield).
select lives_ok(
  $$select tests.create_user(
    '61616161-6161-4616-8616-616161616161',
    'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1',
    'super_admin',
    'Primeiro Super'
  )$$,
  'C2: internal_operators vazia permite o primeiro super_admin'
);

-- Simula operador existente (backfill/migration auditada).
insert into public.internal_operators (user_id)
values ('61616161-6161-4616-8616-616161616161');

-- C2 (≥1 bloqueia): segundo super_admin nega com 42501.
select throws_ok(
  $$select tests.create_user(
    '62626262-6262-4626-8626-626262626262',
    'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2',
    'super_admin',
    'Segundo Super'
  )$$,
  '42501', 'super_admin role is frozen: use internal_operators migration',
  'C2: com ≥1 operador, novo super_admin nega 42501'
);

-- C2 (promoção bloqueia): admin existente não promove para super_admin.
select tests.create_user(
  '63636363-6363-4636-8636-636363636363',
  'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3',
  'admin',
  'Ana Admin'
);
select throws_ok(
  $$update public.profiles set role = 'super_admin'
     where id = '63636363-6363-4636-8636-636363636363'$$,
  '42501', 'super_admin role is frozen: use internal_operators migration',
  'C2: promover admin para super_admin com operador existente nega 42501'
);

-- Regressão: update fora de super_admin continua livre.
select lives_ok(
  $$update public.profiles set full_name = 'Ana Renomeada'
     where id = '63636363-6363-4636-8636-636363636363'$$,
  'regressão: update de nome com operador existente é livre'
);

select * from finish();
rollback;
