-- Migration: campanhas (ADR-05 Fase 4) — win-back/aniversário/rebooking: templates,
-- campanhas, envios, segmentação, consentimento, métricas.
-- Escopo: tabelas `campaign_templates`, `campaigns`, `campaign_sends` + RLS/RBAC +
-- RPCs de preview/enqueue/claim/status/métricas. Gating por entitlement `campanhas`
-- é server-side nas RPCs (`tenant_has_feature`) + UI (`usePlanEntitlements`); a RLS
-- segue ancorada em tenant/papel (mesma decisão da ADR-02: sem entitlement a rota some
-- e nenhuma escrita parte, e a RPC nega com FEATURE_DISABLED).
--
-- Status de campanha em pt-BR (espelha waitlist): rascunho|agendada|enviando|
-- concluída|cancelada. `cancelada` = remoção com trilha (sem DELETE físico, P6).
-- Status de envio em inglês (códigos de provedor): queued|sent|delivered|read|
-- replied|converted|failed|excluded_opt_in.
--
-- Segmento (`campaigns.segment`, jsonb): {tags?: string[], last_visit_before_days?: int,
-- no_show_min?: int, service_ids?: uuid[], birthday_month?: int}. Filtros combinados por AND;
-- segmento vazio {} = toda a base ativa. `customers` ganha `tags text[]` + `birthdate date`
-- (aditivo; ADR-08/CRM consome as mesmas colunas). Consentimento LGPD: sem
-- `whatsapp_opt_in=true` o cliente cai em `excluded_opt_in` (contado, nunca enviado).
--
-- Janela de 24h (PRD §7): fora da janela só template aprovado
-- (`campaign_templates.approved_outside_24h=true`); a Edge `campaign-dispatch`
-- aplica a regra (coluna `require_approved_template`, default true). Dentro da janela,
-- mensagem livre futura usa o mesmo `body` renderizado.
--
-- Idempotência: índice único (tenant_id, campaign_id, customer_id); enqueue com
-- on conflict do nothing + replay sinalizado; claim por marcador
-- `provider_message_id='claim:<uuid>'` + `campaign_release_stale_claims`.
-- Conversão: `converted_appointment_id` (appointment criado após o envio na janela
-- `conversion_window_days`) via `campaign_register_status`.
-- Dinheiro: sem valores aqui. Tempo: timestamptz UTC; janela de envio em hora local
-- do tenant (`send_start_hour`/`send_end_hour`, default 9–18, pergunta 6 com default seguro);
-- frequência default 1 envio/30d por cliente (`max_per_customer_30d`).
--
-- Concorrência: enqueue/claim com FOR UPDATE SKIP LOCKED. RPCs SECURITY DEFINER
-- (precisam gravar audit_log, sem policy de escrita p/ authenticated) com tenant
-- derivado de current_tenant_id() em TODA query + gate de papel explícito (PT403).
-- search_path fixo. Idempotente (if not exists / or replace / drop policy if exists).

-- ============================================================================
-- 1. customers — colunas de segmentação (aditivo; ADR-08 consome as mesmas).
-- ============================================================================
alter table public.customers
  add column if not exists tags text[] not null default '{}';

alter table public.customers
  add column if not exists birthdate date;

-- ============================================================================
-- 2. campaign_templates — biblioteca por tenant (reuso em campanhas).
-- ============================================================================
create table if not exists public.campaign_templates (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  name                    text not null check (char_length(name) between 1 and 120),
  body                    text not null check (char_length(body) between 1 and 2000),
  variables               jsonb not null default '[]'::jsonb,
  channel                 text not null default 'whatsapp' check (channel = 'whatsapp'),
  approved_outside_24h    boolean not null default false,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint campaign_templates_tenant_name_unique unique (tenant_id, name),
  constraint campaign_templates_tenant_id_unique unique (tenant_id, id)
);

create index if not exists campaign_templates_tenant_id_idx
  on public.campaign_templates (tenant_id);

alter table public.campaign_templates enable row level security;

-- Leitura: admin + recepção do tenant (recepção lê para operar; envio é server-side).
drop policy if exists campaign_templates_select_staff on public.campaign_templates;
create policy campaign_templates_select_staff on public.campaign_templates for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  );

-- Escrita: só admin (biblioteca editorial do dono). DELETE físico permitido aqui
-- (template referenciado por campanha é protegido pela FK restrict).
drop policy if exists campaign_templates_write_admin on public.campaign_templates;
create policy campaign_templates_write_admin on public.campaign_templates for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

-- ============================================================================
-- 3. campaigns — campanha com preset, segmentação e agendamento.
-- ============================================================================
create table if not exists public.campaigns (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  name                    text not null check (char_length(name) between 1 and 120),
  preset                  text not null
    check (preset in ('win_back','birthday','rebooking','custom')),
  template_id             uuid,
  segment                 jsonb not null default '{}'::jsonb,
  scheduled_at            timestamptz,
  require_approved_template boolean not null default true,
  send_start_hour         int not null default 9 check (send_start_hour between 0 and 23),
  send_end_hour           int not null default 18 check (send_end_hour between 0 and 23),
  max_per_customer_30d    int not null default 1 check (max_per_customer_30d >= 1),
  conversion_window_days  int not null default 7 check (conversion_window_days between 1 and 90),
  status                  text not null default 'rascunho'
    check (status in ('rascunho','agendada','enviando','concluída','cancelada')),
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint campaigns_template_fk
    foreign key (tenant_id, template_id)
    references public.campaign_templates (tenant_id, id) on delete restrict,
  constraint campaigns_tenant_id_unique unique (tenant_id, id)
);

create index if not exists campaigns_tenant_id_idx
  on public.campaigns (tenant_id);
create index if not exists campaigns_tenant_status_idx
  on public.campaigns (tenant_id, status);

alter table public.campaigns enable row level security;

drop policy if exists campaigns_select_staff on public.campaigns;
create policy campaigns_select_staff on public.campaigns for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  );

drop policy if exists campaigns_insert_admin on public.campaigns;
create policy campaigns_insert_admin on public.campaigns for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

drop policy if exists campaigns_update_admin on public.campaigns;
create policy campaigns_update_admin on public.campaigns for update
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

-- Sem DELETE físico pela app: sessões autenticadas (JWT) nunca removem; operações
-- server-side (service role, auth.uid() nulo — limpeza de testes, remoção de tenant)
-- podem. Sem isso, o cascade de tenants e a higiene de testes quebrariam (P6 vale
-- para a app, não para ops).
create or replace function public.campaigns_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists campaigns_no_hard_delete on public.campaigns;
create trigger campaigns_no_hard_delete
  before delete on public.campaigns
  for each row execute function public.campaigns_no_hard_delete();

-- Guarda de transição: rascunho→agendada→enviando→concluída; qualquer→cancelada;
-- terminal (concluída/cancelada) não sai.
create or replace function public.campaigns_validate_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status in ('concluída','cancelada') then
    raise exception 'CAMPAIGN_TERMINAL' using errcode = 'PT409';
  end if;
  if new.status = 'cancelada' then
    return new;
  end if;
  if old.status = 'rascunho' and new.status in ('agendada','enviando') then
    return new;
  end if;
  if old.status = 'agendada' and new.status in ('rascunho','enviando') then
    return new;
  end if;
  if old.status = 'enviando' and new.status = 'concluída' then
    return new;
  end if;
  raise exception 'CAMPAIGN_INVALID_TRANSITION' using errcode = 'PT409';
end;
$$;

drop trigger if exists campaigns_validate_transition_trg on public.campaigns;
create trigger campaigns_validate_transition_trg
  before update of status on public.campaigns
  for each row execute function public.campaigns_validate_transition();

-- ============================================================================
-- 4. campaign_sends — um envio por (campanha, cliente). Idempotente.
-- ============================================================================
create table if not exists public.campaign_sends (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  campaign_id             uuid not null,
  customer_id             uuid not null,
  status                  text not null default 'queued'
    check (status in ('queued','sent','delivered','read','replied','converted','failed','excluded_opt_in')),
  provider_message_id     text,
  claimed_at              timestamptz,
  sent_at                 timestamptz,
  delivered_at            timestamptz,
  read_at                 timestamptz,
  replied_at              timestamptz,
  converted_appointment_id uuid,
  failure_reason          text,
  created_at              timestamptz not null default now(),
  constraint campaign_sends_campaign_fk
    foreign key (tenant_id, campaign_id)
    references public.campaigns (tenant_id, id) on delete restrict,
  constraint campaign_sends_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint campaign_sends_converted_appointment_fk
    foreign key (tenant_id, converted_appointment_id)
    references public.appointments (tenant_id, id) on delete restrict
);

-- Idempotência de enqueue: replay não duplica envio do mesmo cliente na campanha.
create unique index if not exists campaign_sends_no_dup_idx
  on public.campaign_sends (tenant_id, campaign_id, customer_id);

create index if not exists campaign_sends_tenant_campaign_status_idx
  on public.campaign_sends (tenant_id, campaign_id, status);

-- Id de provedor único (claim transitório 'claim:<uuid>' nunca colide).
create unique index if not exists campaign_sends_provider_message_id_idx
  on public.campaign_sends (provider_message_id)
  where provider_message_id is not null;

alter table public.campaign_sends enable row level security;

-- Leitura: admin + recepção do tenant. Sem policy de escrita: envio só via RPCs
-- SECURITY DEFINER (owner) auditados — direct write nega por RLS.
drop policy if exists campaign_sends_select_staff on public.campaign_sends;
create policy campaign_sends_select_staff on public.campaign_sends for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  );

create or replace function public.campaign_sends_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists campaign_sends_no_hard_delete on public.campaign_sends;
create trigger campaign_sends_no_hard_delete
  before delete on public.campaign_sends
  for each row execute function public.campaign_sends_no_hard_delete();

-- ============================================================================
-- 5. Entitlement `campanhas` (server-side; UI usa usePlanEntitlements).
-- ============================================================================
create or replace function public.tenant_has_feature(p_tenant_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.tenants t
      join public.plans p on p.slug = t.plan
     where t.id = p_tenant_id
       and p.features ? p_feature
  );
$$;

comment on function public.tenant_has_feature(uuid, text) is
  'Gate server-side de entitlement por tenant (ADR-01 Fase 4). Lê tenants.plan + plans.features.';

revoke all on function public.tenant_has_feature(uuid, text) from public, anon, authenticated;

-- Catálogo: `campanhas` em premium/enterprise (mesmo recorte de estoque/comissao_produto).
update public.plans
   set features = features || '["campanhas"]'::jsonb
 where slug in ('premium','enterprise')
   and not (features ? 'campanhas');

-- ============================================================================
-- 6. Segmentação — um cliente casa com o segmento? (interna, sem grants).
-- ============================================================================
create or replace function public.campaign_customer_matches(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_segment jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tags text[] := '{}';
  v_cust_tags text[] := '{}';
  v_no_show_min int := 0;
  v_no_show_count int := 0;
  v_last_days int := 0;
  v_last_visit timestamptz;
  v_service_ids uuid[] := '{}';
  v_birthday_month int := 0;
  v_birthdate date;
begin
  if p_segment is null or p_segment = '{}'::jsonb then
    return exists (
      select 1 from public.customers c
       where c.tenant_id = p_tenant_id
         and c.id = p_customer_id
         and c.active = true
    );
  end if;

  select c.tags, c.birthdate into v_cust_tags, v_birthdate
    from public.customers c
   where c.tenant_id = p_tenant_id
     and c.id = p_customer_id
     and c.active = true;
  if not found then
    return false;
  end if;

  -- tags: interseção não vazia.
  if p_segment ? 'tags'
     and jsonb_typeof(p_segment->'tags') = 'array'
     and jsonb_array_length(p_segment->'tags') > 0 then
    select coalesce(array_agg(t), '{}') into v_tags
      from jsonb_array_elements_text(p_segment->'tags') t;
    if not (coalesce(v_cust_tags, '{}') && v_tags) then
      return false;
    end if;
  end if;

  -- no-show mínimo.
  v_no_show_min := coalesce(nullif(p_segment->>'no_show_min', '')::int, 0);
  if v_no_show_min > 0 then
    select count(*)::int into v_no_show_count
      from public.appointments a
     where a.tenant_id = p_tenant_id
       and a.customer_id = p_customer_id
       and a.status = 'nao_compareceu';
    if v_no_show_count < v_no_show_min then
      return false;
    end if;
  end if;

  -- última visita há mais de N dias (sem visita = elegível, inativo total).
  v_last_days := coalesce(nullif(p_segment->>'last_visit_before_days', '')::int, 0);
  if v_last_days > 0 then
    select max(a.starts_at) into v_last_visit
      from public.appointments a
     where a.tenant_id = p_tenant_id
       and a.customer_id = p_customer_id
       and a.status in ('concluido','confirmado','em_atendimento');
    if v_last_visit is not null
       and v_last_visit > now() - (v_last_days || ' days')::interval then
      return false;
    end if;
  end if;

  -- serviço: ao menos um atendimento do serviço listado.
  if p_segment ? 'service_ids'
     and jsonb_typeof(p_segment->'service_ids') = 'array'
     and jsonb_array_length(p_segment->'service_ids') > 0 then
    select coalesce(array_agg((t)::uuid), '{}') into v_service_ids
      from jsonb_array_elements_text(p_segment->'service_ids') t;
    if not exists (
      select 1 from public.appointments a
       where a.tenant_id = p_tenant_id
         and a.customer_id = p_customer_id
         and a.service_id = any (v_service_ids)
    ) then
      return false;
    end if;
  end if;

  -- mês de aniversário (sem birthdate = não casa quando o filtro existe).
  v_birthday_month := coalesce(nullif(p_segment->>'birthday_month', '')::int, 0);
  if v_birthday_month > 0 then
    if v_birthdate is null
       or extract(month from v_birthdate)::int <> v_birthday_month then
      return false;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.campaign_customer_matches(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ============================================================================
-- 7. RPCs públicas.
-- ============================================================================

-- Preview: contagem de elegíveis e excluídos por opt-in (RF-13/RF-15).
create or replace function public.campaign_preview_segment(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_campaign public.campaigns%rowtype;
  v_total int := 0;
  v_eligible int := 0;
  v_excluded int := 0;
  r record;
begin
  if v_role not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_campaign_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_campaign from public.campaigns
   where tenant_id = v_tenant and id = p_campaign_id;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'PT404';
  end if;
  if not public.tenant_has_feature(v_tenant, 'campanhas') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  for r in
    select c.id, c.whatsapp_opt_in
      from public.customers c
     where c.tenant_id = v_tenant
       and c.active = true
  loop
    if public.campaign_customer_matches(v_tenant, r.id, v_campaign.segment) then
      v_total := v_total + 1;
      if coalesce(r.whatsapp_opt_in, false) then
        v_eligible := v_eligible + 1;
      else
        v_excluded := v_excluded + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'total', v_total,
    'eligible', v_eligible,
    'excluded_opt_in', v_excluded
  );
end;
$$;

-- Enqueue: cria sends (queued) só p/ opt-in; demais viram excluded_opt_in (RF-15).
-- Idempotente: linhas existentes não são recriadas; replay sinalizado.
create or replace function public.campaign_enqueue(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_campaign public.campaigns%rowtype;
  v_queued int := 0;
  v_excluded int := 0;
  r record;
begin
  if current_role_name() <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_campaign_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_campaign from public.campaigns
   where tenant_id = v_tenant and id = p_campaign_id
   for update;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'PT404';
  end if;
  if not public.tenant_has_feature(v_tenant, 'campanhas') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  -- Replay: campanha já em execução/concluída não recria nada.
  if v_campaign.status in ('enviando','concluída') then
    select count(*)::int into v_queued from public.campaign_sends
     where tenant_id = v_tenant and campaign_id = p_campaign_id and status = 'queued';
    select count(*)::int into v_excluded from public.campaign_sends
     where tenant_id = v_tenant and campaign_id = p_campaign_id and status = 'excluded_opt_in';
    return jsonb_build_object(
      'campaign_id', p_campaign_id, 'status', v_campaign.status,
      'queued', v_queued, 'excluded_opt_in', v_excluded, 'replayed', true
    );
  end if;
  if v_campaign.status not in ('rascunho','agendada') then
    raise exception 'CAMPAIGN_NOT_ENQUEUEABLE' using errcode = 'PT409';
  end if;

  for r in
    select c.id, c.whatsapp_opt_in
      from public.customers c
     where c.tenant_id = v_tenant
       and c.active = true
  loop
    if not public.campaign_customer_matches(v_tenant, r.id, v_campaign.segment) then
      continue;
    end if;
    if coalesce(r.whatsapp_opt_in, false) then
      insert into public.campaign_sends (tenant_id, campaign_id, customer_id, status)
      values (v_tenant, p_campaign_id, r.id, 'queued')
      on conflict (tenant_id, campaign_id, customer_id) do nothing;
      if found then
        v_queued := v_queued + 1;
      end if;
    else
      insert into public.campaign_sends (tenant_id, campaign_id, customer_id, status)
      values (v_tenant, p_campaign_id, r.id, 'excluded_opt_in')
      on conflict (tenant_id, campaign_id, customer_id) do nothing;
      if found then
        v_excluded := v_excluded + 1;
      end if;
    end if;
  end loop;

  update public.campaigns
     set status = 'enviando', updated_at = now()
   where tenant_id = v_tenant and id = p_campaign_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (v_tenant, auth.uid(), 'campaign_enqueued', 'campaign', p_campaign_id,
          jsonb_build_object('queued', v_queued, 'excluded_opt_in', v_excluded));

  return jsonb_build_object(
    'campaign_id', p_campaign_id, 'status', 'enviando',
    'queued', v_queued, 'excluded_opt_in', v_excluded, 'replayed', false
  );
end;
$$;

-- Claim: drenadora (Edge service role) ou admin reserva até p_limit queued.
-- Marca com 'claim:<uuid>' + claimed_at; replay do mesmo lote não duplica.
create or replace function public.campaign_claim_sends(p_campaign_id uuid, p_limit int default 50)
returns table (send_id uuid, tenant_id uuid, customer_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_limit int := coalesce(p_limit, 50);
begin
  if v_actor is not null and current_role_name() <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_campaign_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if v_limit <= 0 then
    v_limit := 50;
  end if;

  select c.tenant_id into v_tenant from public.campaigns c where c.id = p_campaign_id;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_actor is not null and v_tenant <> current_tenant_id() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'campanhas') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  return query
  update public.campaign_sends s
     set provider_message_id = 'claim:' || gen_random_uuid()::text,
         claimed_at = now()
    from (
      select cs.id from public.campaign_sends cs
       where cs.tenant_id = v_tenant
         and cs.campaign_id = p_campaign_id
         and cs.status = 'queued'
         and cs.provider_message_id is null
       order by cs.created_at asc
       limit v_limit
       for update skip locked
    ) q
   where s.id = q.id
   returning s.id, s.tenant_id, s.customer_id;
end;
$$;

-- Libera claims travados (drenadora caiu após o claim): volta p/ queued.
create or replace function public.campaign_release_stale_claims(
  p_campaign_id uuid,
  p_older_than_minutes int default 15
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_minutes int := coalesce(p_older_than_minutes, 15);
  v_count int := 0;
begin
  if v_actor is not null and current_role_name() <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_campaign_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if v_minutes < 0 then
    v_minutes := 15;
  end if;

  update public.campaign_sends s
     set provider_message_id = null,
         claimed_at = null
   where s.campaign_id = p_campaign_id
     and s.status = 'queued'
     and s.provider_message_id like 'claim:%'
     and s.claimed_at < now() - (v_minutes || ' minutes')::interval
     and (v_actor is null or s.tenant_id = current_tenant_id());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Webhook de status do provedor: delivered|read|replied|converted por provider id.
-- Idempotente: status repetido não move relógio; regressão de funil é ignorada.
create or replace function public.campaign_register_status(
  p_provider_message_id text,
  p_status text,
  p_converted_appointment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_send public.campaign_sends%rowtype;
  v_rank int;
  v_new_rank int;
  v_window_days int := 7;
  v_appt_created timestamptz;
begin
  if v_actor is not null and current_role_name() <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_provider_message_id is null or p_provider_message_id like 'claim:%'
     or p_status not in ('delivered','read','replied','converted') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_send from public.campaign_sends
   where provider_message_id = p_provider_message_id
   for update;
  if not found then
    raise exception 'SEND_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_actor is not null and v_send.tenant_id <> current_tenant_id() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  v_rank := case v_send.status
    when 'queued' then 0 when 'sent' then 1 when 'delivered' then 2
    when 'read' then 3 when 'replied' then 4 when 'converted' then 5
    else -1 end;
  v_new_rank := case p_status
    when 'delivered' then 2 when 'read' then 3
    when 'replied' then 4 when 'converted' then 5 end;

  -- Replay ou regressão: sem efeito, sinaliza replayed.
  if v_new_rank <= v_rank then
    return jsonb_build_object('send_id', v_send.id, 'status', v_send.status, 'replayed', true);
  end if;

  if p_status = 'converted' then
    if p_converted_appointment_id is null then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;
    if not exists (
      select 1 from public.appointments a
       where a.tenant_id = v_send.tenant_id
         and a.id = p_converted_appointment_id
         and a.customer_id = v_send.customer_id
    ) then
      raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
    end if;
    -- Janela de conversão: atendimento criado após o envio e dentro de
    -- conversion_window_days da campanha (promessa do cabeçalho desta migration).
    if v_send.sent_at is null then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;
    select c.conversion_window_days into v_window_days
      from public.campaigns c
     where c.tenant_id = v_send.tenant_id
       and c.id = v_send.campaign_id;
    if not found or v_window_days is null then
      v_window_days := 7;
    end if;
    select a.created_at into v_appt_created
      from public.appointments a
     where a.tenant_id = v_send.tenant_id
       and a.id = p_converted_appointment_id;
    if v_appt_created < v_send.sent_at
       or v_appt_created > v_send.sent_at + (v_window_days || ' days')::interval then
      raise exception 'CONVERSION_OUTSIDE_WINDOW' using errcode = 'PT400';
    end if;
  end if;

  update public.campaign_sends
     set status = p_status,
         delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
         read_at = case when p_status = 'read' then now() else read_at end,
         replied_at = case when p_status = 'replied' then now() else replied_at end,
         converted_appointment_id = case when p_status = 'converted'
           then p_converted_appointment_id else converted_appointment_id end
   where id = v_send.id;

  return jsonb_build_object('send_id', v_send.id, 'status', p_status, 'replayed', false);
end;
$$;

-- Métricas da campanha (RF-14): agregação por status + conversão.
create or replace function public.campaign_metrics(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_counts jsonb;
begin
  if current_role_name() not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_campaign_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if not exists (
    select 1 from public.campaigns c
     where c.tenant_id = v_tenant and c.id = p_campaign_id
  ) then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'PT404';
  end if;

  select jsonb_object_agg(s.status, s.n) into v_counts
    from (
      select status, count(*)::int as n
        from public.campaign_sends
       where tenant_id = v_tenant and campaign_id = p_campaign_id
       group by status
    ) s;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'counts', coalesce(v_counts, '{}'::jsonb)
  );
end;
$$;

-- Grants: RPCs públicas p/ authenticated (job/Edge usa service_role, bypassa).
revoke all on function public.campaign_preview_segment(uuid) from public, anon;
grant execute on function public.campaign_preview_segment(uuid) to authenticated;

revoke all on function public.campaign_enqueue(uuid) from public, anon;
grant execute on function public.campaign_enqueue(uuid) to authenticated;

revoke all on function public.campaign_claim_sends(uuid, int) from public, anon;
grant execute on function public.campaign_claim_sends(uuid, int) to authenticated;

revoke all on function public.campaign_release_stale_claims(uuid, int) from public, anon;
grant execute on function public.campaign_release_stale_claims(uuid, int) to authenticated;

revoke all on function public.campaign_register_status(text, text, uuid) from public, anon;
grant execute on function public.campaign_register_status(text, text, uuid) to authenticated;

revoke all on function public.campaign_metrics(uuid) from public, anon;
grant execute on function public.campaign_metrics(uuid) to authenticated;
