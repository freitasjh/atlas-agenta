-- Migration: rename do ladder de planos (Batch 0.3 — T1.0b).
--
-- Ladder neutro (roadmap v1.4, T1.0 §6): Free / Starter / Premium / Enterprise.
-- Mapeamento (preserva histórico; valores, quotas e preços inalterados):
--   individual → starter   (R$ 59, 1 prof, 150 agend/mês)
--   clinica    → premium   (R$ 149, 5 profs, ilimitado; abrange barbearia/salão/estética)
--   pro        → enterprise(R$ 259, ilimitado)
--   free       → free      (R$ 0, 1 prof, 30 agend/mês; passa a ser atribuível)
--
-- O que muda:
--   1. Catálogo `plans`: UPDATE de slug/nome (PK textual; sem FK apontando).
--   2. Dados: `tenants.plan`, `tenant_plan_changes.old/new_plan`,
--      `subscription_charges.plan` migrados pelo mesmo mapeamento.
--   3. CHECKs recriados com o ladder novo (+ `free` atribuível em todos).
--   4. `admin_set_tenant_plan`: whitelist nova (free/starter/premium/enterprise).
--   5. `admin_get_trial_conversion`: whitelist do filtro `p_plan` nova.
--   6. `create_tenant_with_admin` (14 params): default de cadastro `starter`.
--   7. Default de `tenants.plan`: `starter`.
--
-- O que NÃO muda: `plan_price_cents`/`plan_professional_limit`/
-- `plan_appointment_limit` (já leem a tabela), views/RPCs de telemetria (plan
-- dinâmico), RLS do catálogo, `get_plans()`, segmento de negócio
-- (`barbearia/clinica/salao` — enum distinto, intocado).
--
-- Idempotente (UPDATEs por valor antigo, DO blocks com guarda, insert on
-- conflict do nothing, create or replace). Nenhum segredo. Dinheiro em
-- centavos; tempo em timestamptz UTC.

-- ============================================================================
-- 1. Catálogo `plans`: rename de slug/nome (preço/quotas/features intactos).
-- ============================================================================
update public.plans set slug = 'starter', name = 'Starter', sort_order = 2
  where slug = 'individual';
update public.plans set slug = 'premium', name = 'Premium', sort_order = 3
  where slug = 'clinica';
update public.plans set slug = 'enterprise', name = 'Enterprise', sort_order = 4
  where slug = 'pro';

insert into public.plans (slug, name, price_cents, prof_limit, appt_limit, features, active, sort_order) values
  ('free', 'Free', 0, 1, 30,
   '["agendamento"]'::jsonb, true, 1)
on conflict (slug) do nothing;

-- ============================================================================
-- 2. Dados: migra histórico pelo mapeamento (idempotente: só casa valor antigo).
-- ============================================================================
update public.tenants set plan = 'starter' where plan = 'individual';
update public.tenants set plan = 'premium' where plan = 'clinica';
update public.tenants set plan = 'enterprise' where plan = 'pro';

update public.tenant_plan_changes set old_plan = 'starter' where old_plan = 'individual';
update public.tenant_plan_changes set old_plan = 'premium' where old_plan = 'clinica';
update public.tenant_plan_changes set old_plan = 'enterprise' where old_plan = 'pro';
update public.tenant_plan_changes set new_plan = 'starter' where new_plan = 'individual';
update public.tenant_plan_changes set new_plan = 'premium' where new_plan = 'clinica';
update public.tenant_plan_changes set new_plan = 'enterprise' where new_plan = 'pro';

update public.subscription_charges set plan = 'starter' where plan = 'individual';
update public.subscription_charges set plan = 'premium' where plan = 'clinica';
update public.subscription_charges set plan = 'enterprise' where plan = 'pro';

-- Default de cadastro acompanha o rename (trial nasce starter).
alter table public.tenants alter column plan set default 'starter';

-- ============================================================================
-- 3. CHECKs: derruba os que citam o ladder antigo e recria com o novo + free.
--    Nomes de constraint inline variam; localiza pela definição (robusto a
--    rename/ordem de aplicação e re-executável).
-- ============================================================================
do $$
declare
  r record;
begin
  for r in
    select conname, conrelid::regclass::text as rel
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.tenants'::regclass,
                       'public.tenant_plan_changes'::regclass,
                       'public.subscription_charges'::regclass)
      and pg_get_constraintdef(oid) like '%individual%'
  loop
    execute format('alter table %s drop constraint %I', r.rel, r.conname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenants_plan_check'
      and conrelid = 'public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_plan_check
      check (plan in ('free','starter','premium','enterprise'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_plan_changes_old_plan_check'
      and conrelid = 'public.tenant_plan_changes'::regclass
  ) then
    alter table public.tenant_plan_changes
      add constraint tenant_plan_changes_old_plan_check
      check (old_plan in ('free','starter','premium','enterprise'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_plan_changes_new_plan_check'
      and conrelid = 'public.tenant_plan_changes'::regclass
  ) then
    alter table public.tenant_plan_changes
      add constraint tenant_plan_changes_new_plan_check
      check (new_plan in ('free','starter','premium','enterprise'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscription_charges_plan_check'
      and conrelid = 'public.subscription_charges'::regclass
  ) then
    alter table public.subscription_charges
      add constraint subscription_charges_plan_check
      check (plan is null or plan in ('free','starter','premium','enterprise'));
  end if;
end $$;

-- ============================================================================
-- 4. `admin_set_tenant_plan`: whitelist do ladder novo (free atribuível).
--    Corpo idêntico ao da 20261114000000; só a lista de planos muda.
-- ============================================================================
create or replace function public.admin_set_tenant_plan(
  p_tenant_id uuid,
  p_new_plan text,
  p_changed_by uuid,
  p_reason text,
  p_override boolean default false
)
returns table (old_plan text, new_plan text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old text;
  v_prof_count int;
  v_appt_count int;
  v_prof_limit int;
  v_appt_limit int;
  v_tz text;
  v_month_key text;
begin
  if p_new_plan not in ('free','starter','premium','enterprise') then
    raise exception 'invalid_plan' using errcode = 'check_violation';
  end if;
  if p_reason is null or char_length(p_reason) < 10 then
    raise exception 'reason_too_short' using errcode = 'check_violation';
  end if;
  if char_length(p_reason) > 280 then
    raise exception 'reason_too_long' using errcode = 'check_violation';
  end if;

  select t.plan, t.timezone into v_old, v_tz
    from public.tenants t
    where t.id = p_tenant_id
    for update;
  if v_old is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  if v_old = p_new_plan then
    raise exception 'same_plan' using errcode = 'unique_violation';
  end if;

  -- Downgrade (ou qualquer troca para plano com limite): valida uso, salvo override.
  v_prof_limit := public.plan_professional_limit(p_new_plan);
  v_appt_limit := public.plan_appointment_limit(p_new_plan);
  if (v_prof_limit is not null or v_appt_limit is not null) and coalesce(p_override, false) = false then
    -- Fecha a corrida conta-linhas-then-insert com os triggers PLAN_LIMIT (G29).
    perform pg_advisory_xact_lock(hashtext('plan_limit:prof:' || p_tenant_id::text));
    perform pg_advisory_xact_lock(hashtext('plan_limit:appt:' || p_tenant_id::text));

    v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');
    v_month_key := to_char((now() at time zone v_tz), 'YYYY-MM');
    select count(*)::int into v_prof_count from public.professionals p
      where p.tenant_id = p_tenant_id and p.active = true;
    select count(*)::int into v_appt_count from public.appointments a
      where a.tenant_id = p_tenant_id
        and a.status != 'cancelado'
        and to_char((a.starts_at at time zone v_tz), 'YYYY-MM') = v_month_key;
    if v_prof_limit is not null and v_prof_count > v_prof_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % profissionais ativos (uso atual: %).',
        p_new_plan, v_prof_limit, v_prof_count using errcode = 'check_violation';
    end if;
    if v_appt_limit is not null and v_appt_count > v_appt_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % agendamentos por mês (uso atual: %).',
        p_new_plan, v_appt_limit, v_appt_count using errcode = 'check_violation';
    end if;
  end if;

  update public.tenants set plan = p_new_plan where id = p_tenant_id;

  insert into public.tenant_plan_changes
    (tenant_id, changed_by, old_plan, new_plan, reason, override_flag)
  values
    (p_tenant_id, p_changed_by, v_old, p_new_plan, p_reason, coalesce(p_override, false));

  return query select v_old, p_new_plan;
end;
$$;

-- ============================================================================
-- 5. `admin_get_trial_conversion`: whitelist do filtro `p_plan` nova.
-- ============================================================================
create or replace function public.admin_get_trial_conversion(p_start date, p_end date, p_plan text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_coorte int;
  v_conv int;
begin
  if current_role_name() is distinct from 'super_admin' and not public.is_active_internal_operator() then
    return null;
  end if;
  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'invalid_range' using errcode = 'check_violation';
  end if;
  if p_plan is not null and p_plan not in ('free','starter','premium','enterprise') then
    raise exception 'invalid_plan' using errcode = 'check_violation';
  end if;
  with coorte as (
    select id, created_at
    from public.tenants
    where created_at::date >= p_start
      and created_at::date <= p_end
      and created_at <= now() - interval '14 days'
      and (p_plan is null or plan = p_plan)
  ),
  convertidos as (
    select distinct s.tenant_id
    from public.subscription_status_changes s
    join coorte c on c.id = s.tenant_id
    where s.old_status = 'trial'
      and s.new_status = 'ativo'
      and s.created_at <= c.created_at + interval '14 days'
  )
  select (select count(*)::int from coorte),
         (select count(*)::int from convertidos)
    into v_coorte, v_conv;
  return jsonb_build_object(
    'coorte', v_coorte,
    'convertidos', v_conv,
    'taxa', case when v_coorte = 0 then null
                 else (v_conv::numeric * 100.0 / v_coorte) end
  );
end;
$$;

-- ============================================================================
-- 6. `create_tenant_with_admin` (14 params): cadastro trial nasce `starter`.
--    Corpo idêntico ao da 20261105090000; só o literal do plano muda.
-- ============================================================================
create or replace function public.create_tenant_with_admin(
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

  -- Empresa nova em trial (14 dias). Plano inicial: starter (rename T1.0b).
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
    'starter',
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

revoke all on function public.create_tenant_with_admin(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text
)
  from public, anon, authenticated;
grant execute on function public.create_tenant_with_admin(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text
)
  to service_role;

comment on table public.plans is
  'Catalogo SSoT de planos (T1.0): preco em centavos, quotas e features. '
  'Ladder neutro (T1.0b): free/starter/premium/enterprise — rename de '
  'individual/clinica/pro com historico migrado (tenants, tenant_plan_changes, '
  'subscription_charges). Unica fonte lida por plan_price_cents/'
  'plan_professional_limit/plan_appointment_limit, pela Edge Function '
  'create-subscription-charge e pelo frontend via get_plans().';
