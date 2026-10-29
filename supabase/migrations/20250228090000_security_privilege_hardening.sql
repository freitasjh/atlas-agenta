-- Migration: hardening de privilégios de profiles e tenants (ADR-02, ADR-03, ADR-04)
-- Fecha as brechas de privilégio do PRD de segurança. Esta migration é nova e não foi
-- aplicada em ambiente compartilhado: as seções de tenants (ADR-03) e de TRUNCATE (ADR-04)
-- são acrescentadas aqui. Depois do merge, qualquer correção vira migration nova.
--
-- Seção profiles (ADR-02, achado sec-profiles-role-escalation, crítico):
-- a policy profiles_update_self_or_admin (migration 20250216091000, já aplicada) não restringe
-- colunas, e authenticated tinha UPDATE na tabela inteira. Um usuário alterava o próprio `role`
-- para admin ou super_admin, e um admin promovia um colega a super_admin.
--
-- Estratégia (PRD S-01): duas camadas.
--   1. Grant de coluna (fronteira principal). Authenticated perde o UPDATE de tabela e recebe
--      UPDATE só em `full_name`. Qualquer outra coluna (role, tenant_id, id) é recusada pelo
--      motor com SQLSTATE 42501, sem código extra. Vale para todos os papéis do cliente,
--      inclusive super_admin: a troca de papel fica para Edge Function com service role ou RPC
--      security definer auditada (backlog, PRD S-06).
--   2. Policy profiles_update_self_or_admin, recriada com a mesma cláusula USING e com o
--      WITH CHECK da master (tenant do usuário, ou super_admin). Barra escrita em outro tenant.
--      A policy não enxerga OLD.role, então ela não é barreira de papel.
--
-- Escrita de anon: anon mantém UPDATE de tabela (sem revoke). A RLS é a única barreira: sem
-- policy permissiva para anon, o UPDATE afeta 0 linhas, sem erro. O smoke 00-smoke-anon (ADR-01)
-- exige esse comportamento sem alteração (decisão 2b, PRD S-07 e AC-17). Residual: anon não tem
-- barreira de coluna. Se uma policy permissiva para anon surgir, role e tenant_id ficam
-- graváveis por anon. A correção é backlog junto com o revoke de anon.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); nenhum tempo aqui.

-- 1. Seção profiles.
revoke update on table public.profiles from authenticated;
grant update (full_name) on table public.profiles to authenticated;

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles for update
  using (
    id = auth.uid()
    or (current_role_name() = 'admin' and tenant_id = current_tenant_id())
  )
  with check (
    tenant_id = current_tenant_id()
    or current_role_name() = 'super_admin'
  );

-- Limpeza de versão anterior desta mesma migration, que criava um trigger de papel. Esse trigger
-- foi retirado (PRD S-01). A limpeza é idempotente e não afeta banco que nunca o teve.
drop trigger if exists profiles_guard_role_tenant on public.profiles;
drop function if exists profiles_guard_role_tenant();
