-- Migration: bootstrap_super_admin trava a régua e as funções de seed deixam de ser chamáveis por
-- cliente (ADR-04, correção após revisão B, achados 1 e 2).
-- Substitui a função de 20250228092200 (já aplicada, por isso não é editada).
--
-- Mudanças:
--   1. Passo 4b trava as message_templates do tenant (for update) antes de comparar a régua.
--      Sem a trava, uma edição do admin confirmada entre a checagem e o delete do tenant era
--      apagada pelo cascade sem erro. Com a trava, a edição espera a conversão terminar, ou já
--      estava commitada e é recusada pela comparação.
--   2. seed_template_texts e seed_message_templates: revoke de public, anon, authenticated e
--      service_role. Ambas são chamadas só pelo trigger handle_new_user (security definer, dono
--      postgres) e pela própria bootstrap_super_admin, então o dono executa sem grant extra.
--      Antes, anon e authenticated podiam chamar seed_message_templates com um p_tenant_id livre.

-- ============================================================================
-- 1. Grants das funções de seed.
-- ============================================================================
revoke all on function public.seed_template_texts(text) from public, anon, authenticated, service_role;
revoke all on function public.seed_message_templates(uuid, text) from public, anon, authenticated, service_role;

-- ============================================================================
-- 2. bootstrap_super_admin com trava das message_templates antes da checagem da régua.
-- ============================================================================
create or replace function public.bootstrap_super_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_tenant_id uuid;
  v_segment text;
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
    raise exception 'Usuário não encontrado para virar super admin.' using errcode = 'P0002';
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
  --    exceto profiles (já verificado acima) e message_templates (tratadas no passo 4b).
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

  -- 4b. A régua precisa estar exatamente como o seed do ramo a gravou: uma linha por chave, texto
  --     igual e ativa. Qualquer edição do admin (texto, ativação, exclusão de linha ou linha extra)
  --     recusa a conversão. As linhas são travadas antes da comparação: um UPDATE concorrente
  --     espera esta transação terminar, em vez de ser apagado pelo cascade do passo 6.
  perform 1 from public.message_templates mt where mt.tenant_id = v_tenant_id for update;

  select t.segment into v_segment from public.tenants t where t.id = v_tenant_id;

  if exists (
       select 1
         from public.message_templates mt
        where mt.tenant_id = v_tenant_id
          and (
            mt.active is not true
            or not exists (
              select 1
                from public.seed_template_texts(v_segment) e
               where e.template_key = mt.template_key
                 and e.body = mt.body
            )
          )
     )
     or (select count(*) from public.message_templates mt where mt.tenant_id = v_tenant_id)
        <> (select count(*) from public.seed_template_texts(v_segment)) then
    raise exception 'A régua de mensagens desta empresa foi editada. Nada foi alterado; a conversão precisa ser feita manualmente.';
  end if;

  -- 5. Converte o profile para super admin sem tenant, com troca obrigatória ligada.
  update public.profiles
     set role = 'super_admin',
         tenant_id = null,
         must_change_password = true
   where id = p_user_id;

  -- 6. Remove o tenant órfão. Só as message_templates do trigger caem em cascata, e o passo 4b
  --    garante que elas estão intactas.
  delete from public.tenants where id = v_tenant_id;

  return true;
end;
$$;

comment on function public.bootstrap_super_admin(uuid) is
  'Converte o administrador recém-cadastrado p_user_id em super_admin sem tenant, com '
  'must_change_password ligado (ADR-04). Idempotente: retorna false se já existe super_admin. '
  'Recusa perfil que não seja admin, tenant com outros usuários ou dados, e régua editada. Remove '
  'o tenant órfão do cadastro só quando ele tem apenas a régua do trigger, intacta. Só service_role '
  'executa. Não cria usuário no Auth e não recebe senha.';

-- Permissões: menor privilégio, reafirmadas após o replace.
revoke all on function public.bootstrap_super_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid) to service_role;
