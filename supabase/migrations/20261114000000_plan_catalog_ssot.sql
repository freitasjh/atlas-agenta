-- Migration: catálogo SSoT de planos (T1.0 / G21 / G22 / G29).
--
-- Estabelece a fonte única de planos (preço, quotas e features) no backend:
-- a tabela `public.plans`. As functions `plan_price_cents`,
-- `plan_professional_limit` e `plan_appointment_limit` passam a ler dela
-- (deixam de ser `immutable` e viram `stable`), e a Edge Function
-- `create-subscription-charge` passa a ler o preço da tabela (service role).
--
-- Seed (dados atuais; o rename Free/Starter/Premium/Enterprise é o Batch 0.3):
--   free       (novo)  R$ 0     1 prof   30 agend/mês
--   individual          R$ 59    1 prof   150 agend/mês
--   clinica             R$ 149   5 profs  ilimitado
--   pro                 R$ 259   ilimitado
--
-- RLS: catálogo público — SELECT para anon/authenticated, sem escrita de
-- cliente. `get_plans()` é o RPC de leitura para o frontend (Batch 0.3).
--
-- TOCTOU (G29): `pg_advisory_xact_lock` por (tenant, bucket) no topo de
-- `enforce_professional_plan_limit()` e `enforce_appointment_plan_limit()` e
-- no ramo de downgrade de `admin_set_tenant_plan()`. O ramo de downgrade
-- adquire os dois buckets na mesma ordem (prof → appt) para fechar a corrida
-- conta-linhas-then-insert com os triggers.
--
-- Idempotente (create table if not exists, drop/create policy, create or
-- replace function, insert on conflict do nothing, revoke antes de grant).
-- Nenhum segredo.

-- ============================================================================
-- 1. Tabela `plans` (SSoT).
-- ============================================================================
create table if not exists public.plans (
  slug        text primary key check (slug ~ '^[a-z0-9_-]+$'),
  name        text not null,
  price_cents integer not null check (price_cents >= 0),
  prof_limit  integer check (prof_limit is null or prof_limit > 0),
  appt_limit  integer check (appt_limit is null or appt_limit > 0),
  features    jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  sort_order  integer not null default 0
);

comment on table public.plans is
  'Catalogo SSoT de planos (T1.0): preco em centavos, quotas e features. '
  'Unica fonte lida por plan_price_cents/plan_professional_limit/'
  'plan_appointment_limit, pela Edge Function create-subscription-charge e, '
  'no Batch 0.3, pelo frontend via get_plans().';

-- ============================================================================
-- 2. RLS: leitura pública, escrita somente server-side (service role/definer).
-- ============================================================================
alter table public.plans enable row level security;

revoke all on table public.plans from public;
revoke all on table public.plans from anon, authenticated;
grant select on table public.plans to anon, authenticated;

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read
  on public.plans for select
  to anon, authenticated
  using (true);

-- Nenhuma policy de INSERT/UPDATE/DELETE: escrita só por service role ou
-- function security definer (mesmo padrão do catálogo de domínio).

-- ============================================================================
-- 3. Seed (idempotente; não sobrescreve ajuste manual de produção).
-- ============================================================================
insert into public.plans (slug, name, price_cents, prof_limit, appt_limit, features, active, sort_order) values
  ('free', 'Free', 0, 1, 30,
   '["agendamento"]'::jsonb, true, 1),
  ('individual', 'Individual', 5900, 1, 150,
   '["agendamento","pdv_checkout","cobranca_pix","whatsapp","comissao_profissional","relatorios"]'::jsonb, true, 2),
  ('clinica', 'Clínica', 14900, 5, null,
   '["agendamento","pdv_checkout","cobranca_pix","whatsapp","comissao_profissional","combos_pacotes","prontuario","pacotes_sessoes","estoque_backbar","relatorios"]'::jsonb, true, 3),
  ('pro', 'Pro', 25900, null, null,
   '["agendamento","pdv_checkout","cobranca_pix","whatsapp","comissao_profissional","combos_pacotes","prontuario","pacotes_sessoes","estoque_backbar","relatorios","multi_unidade"]'::jsonb, true, 4)
on conflict (slug) do nothing;

-- ============================================================================
-- 4. Functions do banco leem a tabela (estáveis; assinaturas preservadas).
-- ============================================================================
create or replace function public.plan_price_cents(p_plan text)
returns int
language sql
stable
as $$
  select coalesce(
    (select price_cents from public.plans where slug = p_plan),
    0
  );
$$;

comment on function public.plan_price_cents(text) is
  'Preco mensal em centavos lido do catalogo SSoT public.plans (T1.0). '
  'Retorna 0 para slug inexistente (preserva o contrato dos call sites).';

create or replace function public.plan_professional_limit(p_plan text)
returns int
language sql
stable
as $$
  select prof_limit from public.plans where slug = p_plan;
$$;

comment on function public.plan_professional_limit(text) is
  'Limite de profissionais ativos lido do catalogo SSoT public.plans (T1.0). '
  'Null = ilimitado ou slug inexistente.';

create or replace function public.plan_appointment_limit(p_plan text)
returns int
language sql
stable
as $$
  select appt_limit from public.plans where slug = p_plan;
$$;

comment on function public.plan_appointment_limit(text) is
  'Limite de agendamentos por mes lido do catalogo SSoT public.plans (T1.0). '
  'Null = ilimitado ou slug inexistente.';

-- ============================================================================
-- 5. RPC de leitura do catálogo (frontend; Batch 0.3 consome por aqui).
-- ============================================================================
create or replace function public.get_plans()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slug', slug,
        'name', name,
        'price_cents', price_cents,
        'prof_limit', prof_limit,
        'appt_limit', appt_limit,
        'features', features,
        'active', active,
        'sort_order', sort_order
      )
      order by sort_order, slug
    ),
    '[]'::jsonb
  )
  from public.plans
  where active;
$$;

comment on function public.get_plans() is
  'Catalogo SSoT de planos ativos (preco/quotas/features), ordenado por '
  'sort_order. Leitura publica (anon/authenticated); escrita nunca pelo cliente.';

revoke all on function public.get_plans() from public;
grant execute on function public.get_plans() to anon, authenticated;

-- ============================================================================
-- 6. TOCTOU (G29): advisory lock por (tenant, bucket) nos triggers e no
--    ramo de downgrade. A ordem de aquisição é prof → appt em todos os pontos.
-- ============================================================================
create or replace function public.enforce_professional_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan text;
  v_limit int;
  v_count int;
  v_self_counted boolean := false;
begin
  -- Desativar nunca precisa de limite.
  if coalesce(new.active, true) = false then
    return new;
  end if;
  -- Serializa a checagem conta-linhas-then-insert por tenant (G29).
  perform pg_advisory_xact_lock(hashtext('plan_limit:prof:' || new.tenant_id::text));

  if TG_OP = 'UPDATE'
    and coalesce(old.active, false) = true
    and old.tenant_id is not distinct from new.tenant_id then
    v_self_counted := true;
  end if;
  select t.plan into v_plan from public.tenants t where t.id = new.tenant_id;
  if v_plan is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  v_limit := public.plan_professional_limit(v_plan);
  if v_limit is null then
    return new;
  end if;
  select count(*)::int into v_count from public.professionals p
    where p.tenant_id = new.tenant_id and p.active = true;
  if v_self_counted then
    if v_count > v_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % profissional(is) ativo(s).',
        v_plan, v_limit using errcode = 'check_violation';
    end if;
  elsif v_count >= v_limit then
    raise exception 'PLAN_LIMIT: Limite do plano %: máximo % profissional(is) ativo(s).',
      v_plan, v_limit using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_appointment_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan text;
  v_tz text;
  v_limit int;
  v_count int;
  v_new_month text;
  v_self_counted boolean := false;
begin
  -- Cancelar/sair cancelado nunca precisa de limite: cancelado não conta.
  if coalesce(new.status, '') = 'cancelado' then
    return new;
  end if;
  -- Serializa a checagem conta-linhas-then-insert por tenant (G29).
  perform pg_advisory_xact_lock(hashtext('plan_limit:appt:' || new.tenant_id::text));

  select t.plan, t.timezone into v_plan, v_tz
    from public.tenants t where t.id = new.tenant_id;
  if v_plan is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;
  v_limit := public.plan_appointment_limit(v_plan);
  if v_limit is null then
    return new;
  end if;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');
  v_new_month := to_char((new.starts_at at time zone v_tz), 'YYYY-MM');
  if TG_OP = 'UPDATE'
    and coalesce(old.status, '') != 'cancelado'
    and old.tenant_id is not distinct from new.tenant_id
    and to_char((old.starts_at at time zone v_tz), 'YYYY-MM') = v_new_month then
    v_self_counted := true;
  end if;
  select count(*)::int into v_count from public.appointments a
    where a.tenant_id = new.tenant_id
      and a.status != 'cancelado'
      and to_char((a.starts_at at time zone v_tz), 'YYYY-MM') = v_new_month;
  if v_self_counted then
    if v_count > v_limit then
      raise exception 'PLAN_LIMIT: Limite do plano %: máximo % agendamentos por mês.',
        v_plan, v_limit using errcode = 'check_violation';
    end if;
  elsif v_count >= v_limit then
    raise exception 'PLAN_LIMIT: Limite do plano %: máximo % agendamentos por mês.',
      v_plan, v_limit using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 7. Ramo de downgrade de admin_set_tenant_plan: adquire os dois buckets na
--    mesma ordem dos triggers (prof → appt) antes de contar o uso.
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
  if p_new_plan not in ('individual','clinica','pro') then
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

comment on function public.admin_set_tenant_plan(uuid, text, uuid, text, boolean) is
  'Troca tenants.plan com trilha atomica em tenant_plan_changes (service role via Edge admin-plan). '
  'Upgrade imediato sem validacao de uso; downgrade valida limites salvo override=true (auditado). '
  'TOCTOU (G29): advisory lock por (tenant, bucket) no ramo de downgrade, na mesma ordem dos triggers.';
