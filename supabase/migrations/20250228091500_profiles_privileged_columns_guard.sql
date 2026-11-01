-- Migration: profiles_privileged_columns_guard (ADR-02, painel super admin)
-- Fecha o escalonamento de privilégio em `profiles` pelo cliente. Antes desta migration, a policy
-- `profiles_update_self_or_admin` (20250216091000) deixava o usuário atualizar a própria linha sem
-- restringir colunas, então `update profiles set role = 'super_admin'` pelo PostgREST funcionava.
-- A policy `profiles_super_admin` era FOR ALL, o que permitia insert e delete em perfis de outros
-- tenants. Sem este bloqueio, o flag `must_change_password` (ADR-01) não protege nada.
--
-- Modelo: mesmo padrão de `tenants_guard_privileged_columns()` (20250227091000). Um trigger
-- BEFORE UPDATE barra a mudança de `id`, `role`, `tenant_id` e `must_change_password` quando a
-- sessão é `authenticated`. Service role, postgres (seed, psql) e funções security definer
-- executadas por esses papéis têm `auth.role()` diferente de `authenticated`, então a mudança passa.
-- Bootstrap (ADR-04) e troca de senha (ADR-05) seguem funcionando sem exceção especial.
--
-- Escopo desta migration: só o guard de colunas e a redução de `profiles_super_admin` para SELECT.
-- O bloqueio das policies de leitura cross-tenant por flag entra na ADR-03.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); nenhum tempo aqui. Nenhum segredo. Idempotente
-- no re-apply (create or replace function, drop trigger/policy if exists).
-- ============================================================================
-- 1. Trigger function: barra mudança de colunas privilegiadas por sessão do cliente.
-- ============================================================================
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.tenant_id is distinct from old.tenant_id
       or new.must_change_password is distinct from old.must_change_password then
      raise exception 'privileged_column_change_denied'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.profiles_guard_privileged_columns() is
  'Barra a escrita de profiles.id/role/tenant_id/must_change_password por sessao do cliente '
  '(auth.role() = authenticated). Essas colunas ficam restritas ao service role e a funcoes '
  'security definer executadas por ele (bootstrap, troca de senha). Fecha o escalonamento de '
  'privilegio em profiles (ADR-02 Super Admin). Edicao de full_name segue permitida. Nenhum segredo.';

-- ============================================================================
-- 2. Trigger BEFORE UPDATE da linha inteira, para comparar OLD/NEW das quatro colunas em qualquer
--    UPDATE, inclusive quando elas vêm junto de full_name no mesmo SET.
-- ============================================================================
drop trigger if exists profiles_guard_privileged_columns_trg on public.profiles;
create trigger profiles_guard_privileged_columns_trg
  before update on public.profiles
  for each row
  execute function public.profiles_guard_privileged_columns();

-- ============================================================================
-- 3. Reduzir a policy de super_admin de FOR ALL para SELECT. O super_admin continua lendo perfis de
--    qualquer tenant pelo cliente. Insert e delete de profiles ficam negados para a sessão do
--    cliente em todos os papéis, porque nenhuma outra policy de profiles permite essas operações.
--    A parte de bloqueio por flag da policy fica para a ADR-03.
-- ============================================================================
drop policy if exists profiles_super_admin on public.profiles;
create policy profiles_super_admin on public.profiles for select
  using (current_role_name() = 'super_admin');
