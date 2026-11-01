-- Migration: password_rbac_cleanup (ADR-12, PRD RQ-13/RQ-14/RQ-15, D-08/D-10/D-11/D-17).
-- Remove o desenho antigo de senha e de reserva que sobrou das migrações 20250228090000 a
-- 20250228095100. As migrações aplicadas NÃO são editadas (D-11); toda a remoção entra aqui.
--
-- Pré-requisito: nenhum código lê mais as colunas e funções removidas (ADR-04, ADR-05, ADR-06 e
-- ADR-07..ADR-11 já entraram). O frontend e as Edge Functions passaram a usar
-- `app_metadata.must_change_password` e a RPC `create_tenant_with_admin`.
--
-- A ordem dentro do arquivo importa: policies e trigger saem antes das funções que eles usam, e as
-- funções saem antes das colunas que elas consultam.
--
-- Escopo:
--   1. Recriar as policies cross-tenant do super_admin sem `current_must_change_password()`.
--   2. Remover `profiles_update_self_or_admin` (permitia o cliente atualizar a própria linha).
--   3. Remover o trigger e a função `profiles_guard_privileged_columns`.
--   4. Remover as funções de reserva e de flag.
--   5. Remover as três colunas de senha de `profiles`.
--   6. Revogar TODOS os privilégios de `public.profiles` para anon e authenticated e devolver
--      apenas SELECT (a leitura continua necessária; a escrita passa a ser só server-side).
--   7. Confirmar/criar as constraints de invariante de tenant, conferindo o catálogo e criando
--      apenas a que faltar, nunca duplicando as existentes.
--   8. Preservar `seed_message_templates` e `seed_template_texts`.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); nenhum tempo novo (as colunas de tempo saem).
-- Nenhum segredo no SQL. Idempotente no re-apply (drop policy/trigger/function/column if exists,
-- create policy, DO block com checagem de catálogo).

-- ============================================================================
-- 1. Policies cross-tenant do super_admin voltam a ser só por papel.
--    Mesmas formas de 20250227090000 e 20250227091000, sem a condição de flag de 20250228091800.
-- ============================================================================
drop policy if exists tenants_super_admin_select on public.tenants;
create policy tenants_super_admin_select on public.tenants for select
  using (current_role_name() = 'super_admin');

drop policy if exists tenants_super_admin_update_cadastro on public.tenants;
create policy tenants_super_admin_update_cadastro on public.tenants for update
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

drop policy if exists subscription_status_changes_super_admin
  on public.subscription_status_changes;
create policy subscription_status_changes_super_admin
  on public.subscription_status_changes for select
  using (current_role_name() = 'super_admin');

drop policy if exists profiles_super_admin on public.profiles;
create policy profiles_super_admin on public.profiles for select
  using (current_role_name() = 'super_admin');

-- ============================================================================
-- 2. Remove o UPDATE do próprio perfil. Com o criticidade das colunas já tratada pelo trigger
--    (que também sai nesta migration), a policy deixava o cliente atualizar a própria linha
--    incluindo `role`. A escrita em `profiles` passa a ser só server-side (passo 6).
-- ============================================================================
drop policy if exists profiles_update_self_or_admin on public.profiles;

-- ============================================================================
-- 3. Remove o trigger e a função de guarda de colunas privilegiadas. O trigger sai antes da
--    função, porque depende dela. Sem `cascade` no drop da função: se algo mais depender, a
--    migration falha alto e a ADR volta para revisão.
-- ============================================================================
drop trigger if exists profiles_guard_privileged_columns_trg on public.profiles;
drop function if exists public.profiles_guard_privileged_columns();

-- ============================================================================
-- 4. Remove as funções de reserva e de flag. `release_password_change_claim(uuid)` já saiu em
--    20250228095100; o `if exists` mantém a migration tolerante ao estado anterior.
-- ============================================================================
drop function if exists public.claim_password_change(uuid);
drop function if exists public.release_password_change_claim(uuid);
drop function if exists public.release_password_change_claim(uuid, timestamptz);
drop function if exists public.finish_password_change(uuid, timestamptz);
drop function if exists public.complete_password_change(uuid);
drop function if exists public.current_must_change_password();

-- ============================================================================
-- 5. Remove as colunas de senha. Nenhuma função/policy/trigger as usa depois dos passos 1 a 4.
-- ============================================================================
alter table public.profiles
  drop column if exists must_change_password,
  drop column if exists password_changed_at,
  drop column if exists password_change_claimed_until;

-- ============================================================================
-- 6. Cliente sem escrita em `profiles`. Hoje o frontend só lê. Edição de perfil futura entra por
--    Edge Function (service role) ou por grant de coluna em migração própria.
--    `revoke all` cobre TRUNCATE, REFERENCES e TRIGGER além de INSERT/UPDATE/DELETE (e MAINTAIN
--    no PG 17+), então não sobra privilégio de tabela herdado de grants anteriores. O SELECT é
--    devolvido explicitamente porque a leitura pelo PostgREST depende dele.
-- ============================================================================
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;

-- ============================================================================
-- 7. Invariante de tenant: `super_admin` sem tenant; demais papéis com `tenant_id` obrigatório.
--    Garantia via catálogo (`pg_constraint`): cria apenas a constraint que faltar, por nome,
--    precedida de `drop constraint if exists` (idempotente no re-apply) — nunca duplica a que já
--    existe. `profiles_super_admin_sem_tenant` veio da 20250228094200 e
--    `profiles_tenant_required_for_non_super` da 20250216091000.
-- ============================================================================
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and lower(pg_get_constraintdef(c.oid)) like '%role%super_admin%tenant_id is null%'
  ) then
    alter table public.profiles
      drop constraint if exists profiles_super_admin_sem_tenant;
    alter table public.profiles
      add constraint profiles_super_admin_sem_tenant
      check (role <> 'super_admin' or tenant_id is null);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and lower(pg_get_constraintdef(c.oid)) like '%role%super_admin%tenant_id is not null%'
  ) then
    alter table public.profiles
      drop constraint if exists profiles_tenant_required_for_non_super;
    alter table public.profiles
      add constraint profiles_tenant_required_for_non_super
      check (role = 'super_admin' or tenant_id is not null);
  end if;
end
$$;

-- ============================================================================
-- 8. `seed_message_templates`/`seed_template_texts` NÃO são removidos: continuam sendo a
--    baseline da régua chamada por `create_tenant_with_admin` (ADR-02/RQ-19).
-- ============================================================================
