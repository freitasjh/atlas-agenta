-- Migration: RPC create_tenant_with_admin 14 params (ADR-002 cadastro empresa rico)
-- Versa a RPC de 5 para 14 params: documento (só dígitos 11/14 + DV CPF/CNPJ),
-- telefone (só dígitos 10/11), endereço (cep 8 + logradouro + número + cidade + UF,
-- complemento opcional) e legal_name com fallback para trade_name. Defesa em
-- profundidade: a RPC revalida tudo, mesmo que a Edge já tenha validado.
--
-- DROP explícito do overload de 5 params: CREATE OR REPLACE com outra assinatura
-- criaria overload, não substituição (overload fantasma). Nova migration, sem
-- editar versões aplicadas. Sem segredo neste arquivo. Dinheiro: nenhum.
-- Tempo: timestamptz UTC.
-- ============================================================================
-- 1. Remove o overload antigo de 5 params.
-- ============================================================================
drop function if exists public.create_tenant_with_admin(uuid, text, text, text, text);

-- ============================================================================
-- 2. RPC transacional de cadastro rico. Só o service_role a executa (Edge signup-tenant).
--    Falha levanta erro nomeado com errcode invalid_parameter_value; duplicado no
--    índice tenants_document_key levanta unique_violation (23505), mapeado na Edge
--    para 409 sem ecoar PII. Sem pre-check de duplicado (race-safe).
-- ============================================================================
create function public.create_tenant_with_admin(
  p_user_id uuid,
  p_owner_email text,
  p_trade_name text,
  p_full_name text,
  p_segment text,
  p_legal_name text,
  p_document text,
  p_phone text,
  p_cep text,
  p_street text,
  p_number text,
  p_complement text,
  p_city text,
  p_state text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_legal_name text;
  v_full_name text;
  v_len int;
  v_sum int;
  v_rem int;
  v_dv int;
  v_i int;
begin
  if p_segment is not null and p_segment not in ('barbearia', 'clinica', 'salao') then
    raise exception 'segment_invalid' using errcode = 'invalid_parameter_value';
  end if;

  -- Nome do admin passa a obrigatório (RF06).
  v_full_name := btrim(coalesce(p_full_name, ''));
  if v_full_name = '' then
    raise exception 'nome_admin_obrigatorio' using errcode = 'invalid_parameter_value';
  end if;

  -- Documento: só dígitos, 11 (CPF) ou 14 (CNPJ), com DV válido.
  if p_document is null
    or not (p_document ~ '^[0-9]{11}$' or p_document ~ '^[0-9]{14}$') then
    raise exception 'document_invalido' using errcode = 'invalid_parameter_value';
  end if;
  -- Sequências de dígito repetido (000.../111...) nunca são documento válido.
  if p_document = repeat(substring(p_document from 1 for 1), char_length(p_document)) then
    raise exception 'document_invalido' using errcode = 'invalid_parameter_value';
  end if;
  v_len := char_length(p_document);
  if v_len = 11 then
    -- CPF: d1 sobre as 9 primeiras (pesos 10..2), d2 sobre as 10 (pesos 11..2).
    v_sum := 0;
    for v_i in 1..9 loop
      v_sum := v_sum + substring(p_document from v_i for 1)::int * (11 - v_i);
    end loop;
    v_rem := v_sum % 11;
    v_dv := case when v_rem < 2 then 0 else 11 - v_rem end;
    if substring(p_document from 10 for 1)::int <> v_dv then
      raise exception 'document_invalido' using errcode = 'invalid_parameter_value';
    end if;
    v_sum := 0;
    for v_i in 1..10 loop
      v_sum := v_sum + substring(p_document from v_i for 1)::int * (12 - v_i);
    end loop;
    v_rem := v_sum % 11;
    v_dv := case when v_rem < 2 then 0 else 11 - v_rem end;
    if substring(p_document from 11 for 1)::int <> v_dv then
      raise exception 'document_invalido' using errcode = 'invalid_parameter_value';
    end if;
  else
    -- CNPJ: d1 sobre as 12 primeiras, d2 sobre as 13; peso = 2 + ((distância da
    -- posição do dígito) mod 8), cobrindo a sequência 2..9 da direita para a esquerda.
    v_sum := 0;
    for v_i in 1..12 loop
      v_sum := v_sum + substring(p_document from v_i for 1)::int * (2 + ((12 - v_i) % 8));
    end loop;
    v_rem := v_sum % 11;
    v_dv := case when v_rem < 2 then 0 else 11 - v_rem end;
    if substring(p_document from 13 for 1)::int <> v_dv then
      raise exception 'document_invalido' using errcode = 'invalid_parameter_value';
    end if;
    v_sum := 0;
    for v_i in 1..13 loop
      v_sum := v_sum + substring(p_document from v_i for 1)::int * (2 + ((13 - v_i) % 8));
    end loop;
    v_rem := v_sum % 11;
    v_dv := case when v_rem < 2 then 0 else 11 - v_rem end;
    if substring(p_document from 14 for 1)::int <> v_dv then
      raise exception 'document_invalido' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- Telefone BR sem DDI: só dígitos, 10 ou 11.
  if p_phone is null or p_phone !~ '^[0-9]{10,11}$' then
    raise exception 'telefone_invalido' using errcode = 'invalid_parameter_value';
  end if;

  -- Endereço completo: CEP 8 dígitos + logradouro + número + cidade + UF; só o
  -- complemento é opcional.
  if p_cep is null or p_cep !~ '^[0-9]{8}$'
    or btrim(coalesce(p_street, '')) = ''
    or btrim(coalesce(p_number, '')) = ''
    or btrim(coalesce(p_city, '')) = ''
    or p_state is null or p_state !~ '^[A-Z]{2}$' then
    raise exception 'endereco_incompleto' using errcode = 'invalid_parameter_value';
  end if;

  -- Razão social cai para o nome fantasia quando vazia (RN02).
  v_legal_name := nullif(btrim(coalesce(p_legal_name, '')), '');
  if v_legal_name is null then
    v_legal_name := p_trade_name;
  end if;

  -- Empresa nova em trial (14 dias), igual ao cadastro anterior.
  insert into tenants (
    legal_name, trade_name, owner_email, document, phone,
    plan, subscription_status, trial_ends_at, segment,
    address_cep, address_street, address_number, address_complement,
    address_city, address_state
  )
  values (
    v_legal_name,
    p_trade_name,
    p_owner_email,
    p_document,
    p_phone,
    'individual',
    'trial',
    now() + interval '14 days',
    p_segment,
    p_cep,
    btrim(p_street),
    btrim(p_number),
    nullif(btrim(coalesce(p_complement, '')), ''),
    btrim(p_city),
    p_state
  )
  returning id into v_tenant_id;
  -- Profile admin ligando o usuário Auth recém-criado à empresa. O role é fixo no servidor.
  insert into profiles (id, tenant_id, role, full_name, email, active)
  values (p_user_id, v_tenant_id, 'admin', v_full_name, p_owner_email, true);
  -- Baseline das 5 chaves da régua no mesmo fluxo atômico.
  perform seed_message_templates(v_tenant_id, p_segment);
  return v_tenant_id;
end;
$$;
-- O PostgreSQL concede EXECUTE a PUBLIC por padrão. Fecha para todos e libera só o service role.
revoke all on function public.create_tenant_with_admin(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text
)
  from public, anon, authenticated;
grant execute on function public.create_tenant_with_admin(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text
)
  to service_role;
