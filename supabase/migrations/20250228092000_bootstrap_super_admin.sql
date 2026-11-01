-- Migration: bootstrap_super_admin (ADR-04, acesso inicial do super admin)
-- Converte o profile que o trigger `handle_new_user` cria no cadastro (role 'admin' + tenant
-- órfão em trial) em `super_admin` sem tenant, com troca obrigatória de senha ligada.
-- Não cria usuário no Auth: quem cria é a Edge Function (ADR-06) ou o seed local (ADR-07).
-- Não recebe nem grava senha.
--
-- O tenant órfão NÃO é apagado. O trigger de cadastro já grava dados nele (5 linhas em
-- `message_templates`), e um delete em `tenants` cairia em cascata em todas as tabelas com
-- `tenant_id`. Sem profile apontando para ele, o tenant fica invisível pelo RLS. A limpeza,
-- se for desejada, é tarefa separada e explícita.
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
begin
  -- Serializa execuções concorrentes desta função dentro da transação.
  perform pg_advisory_xact_lock(hashtext('bootstrap_super_admin'));

  -- 1. Já existe super admin: não altera nada.
  if exists (select 1 from public.profiles where role = 'super_admin') then
    return false;
  end if;

  -- 2. Trava a linha do usuário alvo. Sem linha, o cadastro não aconteceu.
  perform 1
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    raise exception 'bootstrap_user_not_found' using errcode = 'P0002';
  end if;

  -- 3. Converte para super admin sem tenant, com troca obrigatória ligada.
  --    O tenant_id antigo sai do profile e o tenant órfão permanece no banco, sem dados
  --    acessíveis pelo RLS.
  update public.profiles
     set role = 'super_admin',
         tenant_id = null,
         must_change_password = true
   where id = p_user_id;

  return true;
end;
$$;

comment on function public.bootstrap_super_admin(uuid) is
  'Converte o profile de p_user_id em super_admin sem tenant, com must_change_password ligado '
  '(ADR-04). Idempotente: retorna false se já existe super_admin. Só service_role executa. '
  'Não apaga tenant nenhum. Não cria usuário no Auth e não recebe senha.';

-- Permissões: menor privilégio. Supabase concede EXECUTE a anon/authenticated por padrão em
-- funções do schema public, então a revogação é explícita.
revoke all on function public.bootstrap_super_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid) to service_role;
