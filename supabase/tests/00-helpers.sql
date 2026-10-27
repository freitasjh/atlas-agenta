-- Harness de testes de banco do Atlas Agenda (ADR-04).
--
-- USO: somente em banco LOCAL de teste (`supabase start` e `supabase test db`, sem --linked
-- nem --db-url). A guarda abaixo recusa banco com dado fora da fixture, mas não substitui
-- o cuidado de rodar só no local.
--
-- Helpers no schema `tests`, nunca em `public`. Só o owner da sessão os chama: `anon` e
-- `authenticated` não têm USAGE no schema nem EXECUTE nas funções. Para trocar de papel,
-- o teste chama `tests.authenticate_as` como owner e volta com `reset role` antes de trocar de novo.
--
-- Dois conceitos separados:
--   - papel do Postgres (`anon` / `authenticated`): o que o PostgREST usaria; é onde a RLS
--     é avaliada. Testes negativos sempre rodam com o papel real, não só como owner.
--   - tenant e papel de app: vêm de `profiles` do usuário, como em produção. Nunca são
--     injetados pelo teste na claim.

-- `supabase test db` executa todo .sql da pasta e espera saída TAP, por isso este arquivo
-- também tem plan: prova que os helpers foram carregados e que os privilégios estão corretos.
create extension if not exists pgtap with schema extensions;

select plan(7);

-- Guarda: fixtures de teste usam domínio `.invalido` (reservado, RFC 2606). Qualquer outro
-- e-mail em tenants ou auth.users indica banco com dado real; o harness recusa rodar nele.
do $$
begin
  if exists (select 1 from public.tenants where owner_email not like '%.invalido')
     or exists (select 1 from auth.users where email not like '%.invalido') then
    raise exception 'harness de teste recusado: banco com dado fora da fixture. Rode só no banco local resetado (supabase db reset).';
  end if;
end
$$;

create schema if not exists tests;

-- Nenhum papel de cliente enxerga o schema de teste.
revoke all on schema tests from public, anon, authenticated;

-- Cria usuário em auth.users + profile ligado a um tenant com um papel de app.
-- O trigger `on_auth_user_created` (migration de signup) cria, ao inserir em auth.users, uma
-- empresa nova e um profile admin. O helper troca esse profile pelo tenant e papel pedidos e
-- remove a empresa órfã criada pelo trigger, para que o banco de teste fique só com o fixture.
create or replace function tests.create_user(
  p_user_id   uuid,
  p_tenant_id uuid,
  p_role      text,
  p_full_name text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_auto_tenant uuid;
begin
  insert into tenants (id, legal_name, owner_email)
  values (p_tenant_id, 'Empresa de teste ' || p_tenant_id::text, 'tenant-' || p_tenant_id::text || '@teste.invalido')
  on conflict (id) do nothing;

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (
    p_user_id,
    'authenticated',
    'authenticated',
    'usuario-' || p_user_id::text || '@teste.invalido',
    '{}'::jsonb
  );

  select tenant_id into v_auto_tenant from profiles where id = p_user_id;

  update profiles
     set tenant_id = p_tenant_id,
         role      = p_role,
         full_name = p_full_name
   where id = p_user_id;

  delete from tenants where id = v_auto_tenant and id <> p_tenant_id;

  return p_user_id;
end;
$$;

revoke all on function tests.create_user(uuid, uuid, text, text) from public, anon, authenticated;

-- Assume o papel do Postgres (`anon` ou `authenticated`) e define as claims do JWT com `sub`.
-- Restrito a esses dois papéis para o helper não virar porta para outro papel.
create or replace function tests.authenticate_as(user_id uuid, role_name text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if role_name not in ('anon', 'authenticated') then
    raise exception 'tests.authenticate_as aceita só anon ou authenticated, recebeu %', role_name;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'role', role_name)::text,
    true
  );
  execute format('set local role %I', role_name);
end;
$$;

revoke all on function tests.authenticate_as(uuid, text) from public, anon, authenticated;

-- Volta ao owner da sessão e limpa as claims. Chamar só como owner (depois de `reset role`).
create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = public
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

revoke all on function tests.clear_authentication() from public, anon, authenticated;

select has_function('tests', 'create_user', 'tests.create_user existe');
select has_function('tests', 'authenticate_as', 'tests.authenticate_as existe');
select has_function('tests', 'clear_authentication', 'tests.clear_authentication existe');

select ok(
  not has_schema_privilege('anon', 'tests', 'USAGE')
  and not has_schema_privilege('authenticated', 'tests', 'USAGE'),
  'anon e authenticated sem USAGE no schema tests'
);

select ok(
  not has_function_privilege('anon', 'tests.create_user(uuid, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'tests.create_user(uuid, uuid, text, text)', 'EXECUTE'),
  'anon e authenticated sem EXECUTE em tests.create_user'
);

select ok(
  not has_function_privilege('anon', 'tests.authenticate_as(uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'tests.authenticate_as(uuid, text)', 'EXECUTE'),
  'anon e authenticated sem EXECUTE em tests.authenticate_as'
);

select ok(
  not has_function_privilege('anon', 'tests.clear_authentication()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'tests.clear_authentication()', 'EXECUTE'),
  'anon e authenticated sem EXECUTE em tests.clear_authentication'
);

select * from finish();
