-- Migration: super_admin_password_gate_rls (ADR-03, bloqueio do painel por flag no banco)
-- Recria as policies cross-tenant do super_admin com a condição `not current_must_change_password()`.
-- Enquanto a troca de senha provisória estiver pendente, a sessão de super_admin lê zero linhas de
-- outras empresas, de subscription_status_changes e de profiles alheios, e não altera tenants.
-- O bloqueio é no banco (RLS), não só na Edge Function, porque o PostgREST usa a sessão do cliente.
--
-- Nome do arquivo: a ADR-03 previa 20250228091600, mas esse prefixo de versão já pertence a
-- 20250228091600_profiles_guard_revoke_execute.sql. Versões duplicadas quebram o
-- `supabase db reset`, então esta migration usa 20250228091800 (depois de todas as migrations
-- de ADR-01 e ADR-02).
--
-- Nenhuma policy de admin, professional ou receptionist muda. Nenhum segredo no SQL.
-- Idempotente no re-apply (drop policy if exists, create policy).
-- ============================================================================
-- 1. tenants: leitura cross-tenant do super_admin bloqueada enquanto o flag estiver ligado.
-- ============================================================================
drop policy if exists tenants_super_admin_select on public.tenants;
create policy tenants_super_admin_select on public.tenants for select
  using (
    current_role_name() = 'super_admin'
    and not public.current_must_change_password()
  );
-- ============================================================================
-- 2. tenants: edição de cadastro pelo super_admin bloqueada enquanto o flag estiver ligado.
--    USING e WITH CHECK recebem a mesma condição, para que nenhum UPDATE passe com o flag ligado.
-- ============================================================================
drop policy if exists tenants_super_admin_update_cadastro on public.tenants;
create policy tenants_super_admin_update_cadastro on public.tenants for update
  using (
    current_role_name() = 'super_admin'
    and not public.current_must_change_password()
  )
  with check (
    current_role_name() = 'super_admin'
    and not public.current_must_change_password()
  );
-- ============================================================================
-- 3. subscription_status_changes: trilha de auditoria só legível sem o flag ligado.
-- ============================================================================
drop policy if exists subscription_status_changes_super_admin
  on public.subscription_status_changes;
create policy subscription_status_changes_super_admin
  on public.subscription_status_changes for select
  using (
    current_role_name() = 'super_admin'
    and not public.current_must_change_password()
  );
-- ============================================================================
-- 4. profiles: leitura cross-tenant do super_admin bloqueada enquanto o flag estiver ligado.
--    A leitura da própria linha continua por profiles_select_same_tenant (id = auth.uid()), que é
--    como o frontend descobre o flag.
-- ============================================================================
drop policy if exists profiles_super_admin on public.profiles;
create policy profiles_super_admin on public.profiles for select
  using (
    current_role_name() = 'super_admin'
    and not public.current_must_change_password()
  );
