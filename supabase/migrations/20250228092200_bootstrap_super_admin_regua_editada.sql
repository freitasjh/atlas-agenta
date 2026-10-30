-- Migration: bootstrap_super_admin recusa tenant com régua editada (ADR-04, correção após revisão B)
-- Substitui a função de 20250228092100 (já aplicada, por isso não é editada).
--
-- Problema: a salvaguarda anterior ignorava message_templates. Um admin que editasse a régua antes
-- da conversão perdia o texto em silêncio, porque o delete do tenant cai em cascata nessas linhas.
--
-- Mudanças:
--   1. seed_template_texts(p_segment): extrai do seed a lista (template_key, body) de cada ramo, ou
--      o genérico quando o ramo é nulo/desconhecido. É a única fonte dos textos padrão para a
--      comparação. seed_message_templates passa a usá-la. O resultado não muda: o conteúdo foi
--      conferido linha a linha contra o seed anterior antes desta migration.
--   2. bootstrap_super_admin compara a régua do tenant com seed_template_texts(segmento do tenant)
--      antes de apagar. Se alguma linha tiver texto diferente, estiver inativa, faltar ou sobrar,
--      recusa com erro em pt-BR e nada é alterado.
--   3. Mensagem de 'usuário não encontrado' em pt-BR. O código P0002 continua sendo a chave estável.

-- ============================================================================
-- 1. Textos padrão da régua, por ramo (fonte única para o seed e para a comparação).
-- ============================================================================
create or replace function seed_template_texts(p_segment text)
returns table (template_key text, body text)
language sql
stable
set search_path = public
as $$
  select seg.template_key, seg.body
  from (values
    ('barbearia', 'confirmacao',
     'Fala {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}. Te espero!'),
    ('barbearia', 'lembrete_d1',
     'E aí {nome}, amanhã tem {servico} na {empresa} às {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
    ('barbearia', 'cobranca',
     'Fala {nome}, segue a cobrança do seu {servico} na {empresa}.'),
    ('barbearia', 'comprovante',
     'Pagamento confirmado, {nome}! Valeu por escolher a {empresa}. Até a próxima!'),
    ('barbearia', 'reagendar_retorno',
     'Fala {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Já já a gente te chama pra marcar um novo horário.'),
    ('clinica', 'confirmacao',
     'Olá {nome}, sua consulta de {servico} na {empresa} está agendada para {dataHora}.'),
    ('clinica', 'lembrete_d1',
     'Olá {nome}, lembrete da sua consulta de {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
    ('clinica', 'cobranca',
     'Olá {nome}, segue a cobrança referente à sua consulta de {servico} na {empresa}.'),
    ('clinica', 'comprovante',
     'Recebemos o pagamento da sua consulta de {servico} na {empresa}. Obrigado, {nome}! Cuide-se.'),
    ('clinica', 'reagendar_retorno',
     'Olá {nome}, recebemos seu pedido de reagendamento da consulta de {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.'),
    ('salao', 'confirmacao',
     'Oi {nome}! Seu horário de {servico} na {empresa} está confirmado para {dataHora}.'),
    ('salao', 'lembrete_d1',
     'Oi {nome}, amanhã é o seu {servico} na {empresa} às {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
    ('salao', 'cobranca',
     'Oi {nome}, segue a cobrança do seu {servico} na {empresa}.'),
    ('salao', 'comprovante',
     'Pagamento recebido, {nome}! Obrigada por escolher a {empresa}. Até breve!'),
    ('salao', 'reagendar_retorno',
     'Oi {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.')
  ) as seg(segment, template_key, body)
  where seg.segment = p_segment
  union all
  select gen.template_key, gen.body
  from (values
    ('confirmacao',
     'Olá {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}.'),
    ('lembrete_d1',
     'Oi {nome}, lembrete do seu {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
    ('cobranca',
     'Olá {nome}, segue a cobrança do seu {servico} na {empresa}.'),
    ('comprovante',
     'Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!'),
    ('reagendar_retorno',
     'Oi {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.')
  ) as gen(template_key, body)
  where not exists (
    select 1
    from (values ('barbearia'), ('clinica'), ('salao')) as known(segment)
    where known.segment = p_segment
  );
$$;

-- ============================================================================
-- 2. seed_message_templates passa a ler os textos de seed_template_texts. Mesma assinatura,
--    mesmo comportamento: insere as 5 chaves e não duplica chave já existente.
-- ============================================================================
create or replace function seed_message_templates(p_tenant_id uuid, p_segment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into message_templates (tenant_id, template_key, body)
  select p_tenant_id, t.template_key, t.body
  from seed_template_texts(p_segment) as t
  on conflict (tenant_id, template_key) do nothing;
end;
$$;

-- ============================================================================
-- 3. bootstrap_super_admin com checagem da régua antes do delete.
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
  --     recusa a conversão, para o delete do tenant não apagar o trabalho dele em silêncio.
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
