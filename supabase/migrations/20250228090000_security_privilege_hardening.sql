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
-- Estratégia: o grant de coluna é a fronteira principal. Authenticated perde o UPDATE de
-- tabela e recebe UPDATE só em `full_name`. Qualquer outra coluna (role, tenant_id, id) é
-- recusada pelo motor com SQLSTATE 42501, sem código extra. A policy é recriada com a mesma
-- cláusula USING e com um WITH CHECK que barra promoção a super_admin por quem não é
-- super_admin. Essa barreira só age se um grant de coluna voltar por engano.
--
-- Troca de papel e de tenant passa a ser caminho futuro por Edge Function com service role ou
-- RPC security definer auditada (backlog).
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
    (tenant_id = current_tenant_id()
      and (role is distinct from 'super_admin' or current_role_name() = 'super_admin'))
    or current_role_name() = 'super_admin'
  );
