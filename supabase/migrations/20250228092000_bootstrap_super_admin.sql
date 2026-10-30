-- Migration: bootstrap_super_admin (ADR-04, acesso inicial do super admin)
-- Converte o profile que o trigger `handle_new_user` cria no cadastro (role 'admin' + tenant
-- órfão em trial) em `super_admin` sem tenant, com troca obrigatória de senha ligada.
-- Não cria usuário no Auth: quem cria é a Edge Function (ADR-06) ou o seed local (ADR-07).
-- Não recebe nem grava senha.
--
-- Ordem dentro da função: o profile sai do tenant ANTES de o tenant ser apagado. Se o tenant
-- fosse apagado primeiro, `profiles.tenant_id ... on delete cascade` removeria o próprio profile.
--
-- Idempotência: se já existe algum `super_admin`, retorna false sem alterar nada. O advisory
-- lock de transação evita que duas chamadas concorrentes criem dois super admins.
--
-- Permissões: só service_role executa (e postgres, dono da função). Sessão `authenticated` e
-- `anon` recebem permission denied.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); nenhum tempo aqui. Nenhum segredo.
-- Idempotente no re-apply (create or replace function).

create or replace function public.bootstrap_super_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tenant_id uuid;
begin
  -- Serializa execuções concorrentes desta função dentro da transação.
  perform pg_advisory_xact_lock(hashtext('bootstrap_super_admin'));

  -- 1. Já existe super admin: não altera nada.
  if exists (select 1 from public.profiles where role = 'super_admin') then
    return false;
  end if;

  -- 2. Trava a linha do usuário alvo. Sem linha, o cadastro não aconteceu.
  select tenant_id into v_tenant_id
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    raise exception 'bootstrap_user_not_found' using errcode = 'P0002';
  end if;

  -- 3. Converte para super admin sem tenant, com troca obrigatória ligada.
  update public.profiles
     set role = 'super_admin',
         tenant_id = null,
         must_change_password = true
   where id = p_user_id;

  -- 4. Remove o tenant órfão, só se nenhum outro profile aponta para ele. Falha de chave
  --    estrangeira aborta a função inteira, e nada fica pela metade.
  if v_tenant_id is not null then
    delete from public.tenants
     where id = v_tenant_id
       and not exists (select 1 from public.profiles where tenant_id = v_tenant_id);
  end if;

  return true;
end;
$$;

comment on function public.bootstrap_super_admin(uuid) is
  'Converte o profile de p_user_id em super_admin sem tenant, com must_change_password ligado '
  '(ADR-04). Idempotente: retorna false se já existe super_admin. Só service_role executa. '
  'Não cria usuário no Auth e não recebe senha. Candidata a docs/ como decisão de bootstrap.';

-- Permissões: menor privilégio. Supabase concede EXECUTE a anon/authenticated por padrão em
-- funções do schema public, então a revogação é explícita.
revoke all on function public.bootstrap_super_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid) to service_role;
