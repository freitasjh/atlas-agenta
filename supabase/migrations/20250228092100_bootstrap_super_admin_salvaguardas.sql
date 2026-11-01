-- Migration: bootstrap_super_admin com salvaguardas (ADR-04, correção após revisão)
-- Substitui a função de 20250228092000 (já aplicada, por isso não é editada).
--
-- Mudanças:
--   1. Valida o profile: precisa ser role 'admin' com tenant, e o tenant não pode ter outros
--      profiles. Caso contrário lança erro em pt-BR e nada é alterado.
--   2. Remove o tenant órfão criado pelo trigger de cadastro, mas só se ele não tiver nenhum
--      dado além do que o trigger gravou (message_templates). Se houver qualquer linha em outra
--      tabela com FK para tenants, aborta: registra um WARNING no log do Postgres com o nome das
--      tabelas e as contagens (sem dados pessoais), e lança erro em pt-BR. Nada é apagado.
--
-- Idempotência, lock, permissões e a regra "não recebe senha nem cria usuário no Auth" continuam
-- as mesmas da 20250228092000.

create or replace function public.bootstrap_super_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_tenant_id uuid;
  v_tabela record;
  v_qtd bigint;
  v_com_dados text := '';
begin
  -- Serializa execuções concorrentes desta função dentro da transação.
  perform pg_advisory_xact_lock(hashtext('bootstrap_super_admin'));

  -- 1. Já existe super admin: não altera nada.
  if exists (select 1 from public.profiles where role = 'super_admin') then
    return false;
  end if;

  -- 2. Trava o profile alvo e lê papel e tenant atuais.
  select p.role, p.tenant_id
    into v_role, v_tenant_id
    from public.profiles p
   where p.id = p_user_id
   for update;

  if not found then
    raise exception 'bootstrap_user_not_found' using errcode = 'P0002';
  end if;

  -- 3. Só o administrador de uma empresa pode virar super admin por esta função.
  if v_role <> 'admin' or v_tenant_id is null then
    raise exception 'Só é possível tornar super admin o administrador de uma empresa recém-cadastrada.';
  end if;

  if exists (
    select 1 from public.profiles
     where tenant_id = v_tenant_id and id <> p_user_id
  ) then
    raise exception 'A empresa deste usuário tem outros usuários. Ele não pode virar super admin por esta função.';
  end if;

  perform 1 from public.tenants where id = v_tenant_id for update;

  -- 4. Salvaguarda: conta as linhas que dependem do tenant em toda tabela com FK para tenants,
  --    exceto profiles (já verificado acima) e message_templates (gravadas pelo trigger).
  for v_tabela in
    select cl.relname as tabela, a.attname as coluna
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.tenants'::regclass
       and array_length(c.conkey, 1) = 1
       and n.nspname = 'public'
       and cl.relname not in ('profiles', 'message_templates')
  loop
    execute format('select count(*) from public.%I where %I = $1', v_tabela.tabela, v_tabela.coluna)
      into v_qtd
      using v_tenant_id;

    if v_qtd > 0 then
      v_com_dados := v_com_dados || format(' %s=%s', v_tabela.tabela, v_qtd);
    end if;
  end loop;

  if v_com_dados <> '' then
    raise warning 'bootstrap_super_admin: tenant % tem dados além do cadastro inicial:%. Nada foi removido.',
      v_tenant_id, v_com_dados;
    raise exception 'A empresa deste usuário já tem registros além do cadastro inicial. Nada foi alterado; a conversão precisa ser feita manualmente.';
  end if;

  -- 5. Converte o profile para super admin sem tenant, com troca obrigatória ligada.
  update public.profiles
     set role = 'super_admin',
         tenant_id = null,
         must_change_password = true
   where id = p_user_id;

  -- 6. Remove o tenant órfão. Só as message_templates do trigger caem em cascata.
  delete from public.tenants where id = v_tenant_id;

  return true;
end;
$$;

comment on function public.bootstrap_super_admin(uuid) is
  'Converte o administrador recém-cadastrado p_user_id em super_admin sem tenant, com '
  'must_change_password ligado (ADR-04). Idempotente: retorna false se já existe super_admin. '
  'Recusa perfil que não seja admin ou tenant com outros usuários ou dados. Remove o tenant '
  'órfão do cadastro só quando ele tem apenas as message_templates do trigger. Só service_role '
  'executa. Não cria usuário no Auth e não recebe senha.';

-- Permissões: menor privilégio, reafirmadas após o replace.
revoke all on function public.bootstrap_super_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid) to service_role;
