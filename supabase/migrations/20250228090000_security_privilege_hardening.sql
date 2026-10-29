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
-- Estratégia em três camadas:
--   1. Grant de coluna (fronteira principal). Authenticated perde o UPDATE de tabela e recebe
--      UPDATE só em `full_name`. Qualquer outra coluna (role, tenant_id, id) é recusada pelo
--      motor com SQLSTATE 42501, sem código extra.
--   2. Trigger profiles_guard_role_tenant (BEFORE UPDATE). Se o grant de role ou tenant_id
--      voltar por regressão, o trigger recusa a alteração de role ou tenant_id feita por cliente
--      (anon/authenticated) que não seja super_admin. Compara OLD e NEW. É security invoker e não
--      lê dado de outro tenant: só consulta o papel do próprio usuário. A mensagem é fixa e não
--      ecoa o valor enviado.
--   3. Policy profiles_update_self_or_admin, recriada com a mesma cláusula USING e com um
--      WITH CHECK que barra promoção a super_admin por quem não é super_admin.
--
-- Trocar papel ou tenant de um usuário passa a ser caminho futuro por Edge Function com service
-- role ou RPC security definer auditada (backlog). Writes de owner e de service_role não passam
-- pelo trigger: o harness de teste (tests.create_user, ADR-01) grava role e tenant_id como owner.
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

-- Camada 2: trigger que segura role e tenant_id mesmo se o grant voltar.
create or replace function profiles_guard_role_tenant()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated')
     and current_role_name() is distinct from 'super_admin'
     and (new.role is distinct from old.role or new.tenant_id is distinct from old.tenant_id)
  then
    raise exception 'alteração de papel ou de empresa não permitida para este usuário'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_tenant on public.profiles;
create trigger profiles_guard_role_tenant
  before update on public.profiles
  for each row execute function profiles_guard_role_tenant();
