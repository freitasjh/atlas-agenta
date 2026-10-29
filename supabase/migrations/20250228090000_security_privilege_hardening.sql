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
--      motor com SQLSTATE 42501, sem código extra. Authenticated também perde INSERT e DELETE de
--      tabela: a policy profiles_super_admin (FOR ALL, migration 20250216091000) liberava a
--      super_admin um DELETE seguido de INSERT, que trocava role e tenant_id. Não há fluxo do
--      app que insira ou apague profile: a linha nasce no trigger handle_new_user (security
--      definer). Vale para todos os papéis do cliente, inclusive super_admin: a troca de papel
--      fica para Edge Function com service role ou RPC security definer auditada (backlog, S-06).
--   2. Policy profiles_update_self_or_admin, recriada com a mesma cláusula USING e com o
--      WITH CHECK da master (tenant do usuário, ou super_admin). Barra escrita em outro tenant.
--      A policy não enxerga OLD.role, então ela não é barreira de papel.
--
-- Super admin: a policy profiles_super_admin passa a ser só SELECT (ver seção profiles). Sem essa
-- redução, a escrita FOR ALL somava por OR à policy de UPDATE e permitia gravar full_name de outro
-- tenant pelo cliente.
--
-- Escrita de anon: anon mantém INSERT, DELETE, UPDATE e TRUNCATE de tabela (sem revoke). A RLS
-- é a única barreira: sem policy permissiva para anon, esses comandos não alteram linha alguma.
-- O smoke 00-smoke-anon (ADR-01) exige esse comportamento sem alteração (decisão 2b, PRD S-07 e
-- AC-17). Residual: anon não tem barreira de coluna nem de linha além da RLS. Se uma policy
-- permissiva para anon surgir, role e tenant_id ficam graváveis por anon. A correção é backlog
-- junto com o revoke de anon. TRUNCATE de authenticated e de anon é tratado na ADR-04.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); nenhum tempo aqui.

-- 1. Seção profiles.
revoke update on table public.profiles from authenticated;
revoke insert, delete on table public.profiles from authenticated;
-- TRIGGER e REFERENCES também saem de authenticated e anon. Com TRIGGER, um usuário anexava um
-- trigger em profiles que fazia todo UPDATE da tabela falhar, para todos os tenants (review ADR-02).
revoke trigger, references on table public.profiles from authenticated, anon;
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

-- Super admin: a policy profiles_super_admin (FOR ALL, migration 20250216091000, já aplicada)
-- somava escrita por OR com a policy de UPDATE acima e deixava o super_admin gravar full_name de
-- profile de outro tenant pelo cliente, sem trilha. Ela é reduzida a SELECT (não removida): o
-- super_admin continua lendo todos os tenants. Escrita cross-tenant fica para caminho explícito e
-- auditado (PRD §4.1 e S-06, backlog). Desvio de PRD §4.2 registrado na ADR-02, decisão humana.
drop policy if exists profiles_super_admin on public.profiles;
create policy profiles_super_admin on public.profiles for select
  using (current_role_name() = 'super_admin');

-- Limpeza de versão anterior desta mesma migration, que criava um trigger de papel. Esse trigger
-- foi retirado (PRD S-01). A limpeza é idempotente e não afeta banco que nunca o teve.
drop trigger if exists profiles_guard_role_tenant on public.profiles;
drop function if exists profiles_guard_role_tenant();
