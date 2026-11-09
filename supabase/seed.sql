-- ============================================================================
-- DEV ONLY - NEVER APPLY PROD
-- ============================================================================
-- Seed do super admin padrão do ambiente LOCAL (`supabase db reset` aplica
-- este arquivo automaticamente; `supabase db seed` aplica isolado).
--
-- Cria a identidade fixa `admin@neox.com.br` (mesmo e-mail do bootstrap da
-- Edge Function `bootstrap-super-admin`, que responde `ja_existe` sem tocar
-- em senha/dados quando esta identidade já existe com profile super_admin):
--   auth.users (UUID fixo) -> auth.identities (provider email)
--     -> public.profiles (super_admin, tenant NULL)
--     -> public.internal_operators
--
-- Idempotente: todo INSERT é `... WHERE NOT EXISTS`, então re-executar nunca
-- sobrescreve senha trocada, MFA enrolado, nem duplica operador/profile.
-- A ordem respeita o freeze de super_admin (trigger
-- `profiles_freeze_super_admin`): o profile nasce com `internal_operators`
-- ainda vazia (greenfield libera); o operador entra em seguida.
--
-- Senha provisória DEV: a mesma do bootstrap (`PROVISIONAL_PASSWORD` em
-- `supabase/functions/_shared/super-admin-bootstrap.ts`). Troca obrigatória
-- no primeiro login (flag `must_change_password` no app_metadata, lido pelo
-- hook `custom-access-token`). NUNCA copiar este arquivo para produção.
-- ============================================================================

-- 1. Usuário no Auth. instance_id vem do catálogo (GoTrue hospedado) com
--    fallback para o nil-UUID que o GoTrue local usa (`auth.instances` vazia
--    no `db reset` local); bcrypt via extensions (custo 6 = dev local rápido).
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change,
  is_super_admin,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select
  'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'::uuid,
  coalesce(
    (select id from auth.instances limit 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ),
  'authenticated', 'authenticated', 'admin@neox.com.br',
  extensions.crypt('AtlasAgenda@123', extensions.gen_salt('bf', 6)),
  now(),
  '', '',
  '', '',
  false,
  '{"provider":"email","providers":["email"],"must_change_password":true}'::jsonb,
  '{}'::jsonb,
  now(), now()
where not exists (
  select 1 from auth.users
  where id = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'::uuid
     or email = 'admin@neox.com.br'
);

-- 2. Identidade email (login por e-mail+senha exige a linha em auth.identities).
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  u.id::text,
  now(), now(), now()
from auth.users u
where u.email = 'admin@neox.com.br'
  and not exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  );

-- 3. Profile super_admin sem tenant (invariante: só super_admin tem tenant NULL).
insert into public.profiles (id, tenant_id, role, full_name)
select u.id, null, 'super_admin', 'Super Admin (dev)'
from auth.users u
where u.email = 'admin@neox.com.br'
  and not exists (select 1 from public.profiles p where p.id = u.id);

-- 4. Operador interno (backfill do seed; re-run nunca duplica).
insert into public.internal_operators (user_id)
select u.id
from auth.users u
where u.email = 'admin@neox.com.br'
  and not exists (
    select 1 from public.internal_operators o where o.user_id = u.id
  );
