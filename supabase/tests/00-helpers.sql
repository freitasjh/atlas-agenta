-- Harness de testes de banco do Atlas Agenda (ADR-04).
--
-- Helpers no schema `tests`, nunca em `public`, para não entrar no schema de produção.
-- Executados pelo `supabase test db` (pgTAP). Ver .agents/tasks/dev-pipeline/adr/adr-04.
--
-- Dois conceitos separados:
--   - papel do Postgres (`anon` / `authenticated`): o que o PostgREST usaria; é onde a RLS
--     é avaliada. Testes negativos sempre rodam com o papel real, não só como owner.
--   - tenant e papel de app: vêm de `profiles` do usuário, como em produção. Nunca são
--     injetados pelo teste na claim.

-- `supabase test db` executa todo .sql da pasta e espera saída TAP, por isso este arquivo
-- também tem plan: prova que os helpers foram carregados. Não rode contra produção; use --local.
create extension if not exists pgtap with schema extensions;

select plan(3);

create schema if not exists tests;

-- O papel sob teste (anon/authenticated) precisa de USAGE no schema para chamar os helpers,
-- por exemplo clear_authentication() depois de trocar de papel. Não fica exposto pelo PostgREST
-- (api.schemas = public, graphql_public) e só existe no banco de teste.
grant usage on schema tests to anon, authenticated;

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

-- Volta ao owner da sessão e limpa as claims.
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

select has_function('tests', 'create_user', 'tests.create_user existe');
select has_function('tests', 'authenticate_as', 'tests.authenticate_as existe');
select has_function('tests', 'clear_authentication', 'tests.clear_authentication existe');

select * from finish();
