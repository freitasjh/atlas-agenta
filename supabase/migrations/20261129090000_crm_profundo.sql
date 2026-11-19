-- Migration: CRM profundo (ADR-08 Fase 4) — preferencias, notas por papel, filtros, opt-in/consentimento.
-- Escopo: extensao de `customers` (preferencias operacionais + consentimento auditavel),
-- tabela `customer_notes` (1:N, visibilidade por papel) + RPCs SECURITY DEFINER de
-- resumo/historico/filtro/consentimento/can-receive. Sem gating por entitlement (ADR-08
-- nao define chave propria; base para campanhas da ADR-05).
--
-- Regras (PRD §6.5 RF-24..RF-30, dominio.md, seguranca-multitenant.md):
--   - *_cents inteiros; timestamptz UTC; ingles/snake_case/plural.
--   - RLS obrigatoria com tenant_id do JWT (current_tenant_id()); cross-tenant barrado.
--   - RBAC financeiro: ticket medio/valores agregados SOMENTE admin — RPCs retornam
--     null para receptionist/professional (nunca vazar via RPC/view).
--   - Notas: admin le/cria todas; receptionist le/cria `operational`; professional le
--     apenas notas `appointment` vinculadas a atendimento proprio. Autoria carimbada
--     por trigger (author_profile_id/auth.uid + author_role), nunca do cliente.
--   - LGPD: whatsapp_opt_in + opt_in_at + lgpd_consent_at/version; disparo bloqueado
--     sem opt-in (customer_can_receive_whatsapp, usada pelo dispatch). Sem PII em logs.
--   - Auditoria: consent update grava audit_log (metadata sem PII alem de ids).
--   - Aditiva e idempotente (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--     Nenhuma migration aplicada e editada. Sem H2. Sem segredos no SQL.
--
-- Decisao (sem guard em customers): o form de clientes escreve whatsapp_opt_in
-- direto hoje; bloquear UPDATE direto quebraria o fluxo existente. A RPC
-- customer_consent_update e o caminho auditado (carimba *_at + versao + audit_log);
-- escrita direta continua possivel como antes, sem regredir.

-- ============================================================================
-- 1. customers — preferencias operacionais + consentimento.
-- ============================================================================
alter table public.customers
  add column if not exists preferred_professional_id uuid,
  add column if not exists preferred_time_window text check (char_length(preferred_time_window) between 1 and 120),
  add column if not exists notes_summary text check (char_length(notes_summary) <= 2000),
  add column if not exists segment text check (char_length(segment) between 1 and 60),
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists whatsapp_opt_in_at timestamptz,
  add column if not exists lgpd_consent_at timestamptz,
  add column if not exists lgpd_consent_version text check (char_length(lgpd_consent_version) between 1 and 40);

-- FK composta por tenant: preferencia so aponta p/ profissional do MESMO tenant.
-- SET NULL: se o profissional sai, a preferencia evapora sem levar o cliente.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_preferred_professional_fk'
  ) then
    alter table public.customers
      add constraint customers_preferred_professional_fk
      foreign key (tenant_id, preferred_professional_id)
      references public.professionals (tenant_id, id) on delete set null;
  end if;
end
$$;

create index if not exists customers_segment_idx on public.customers (tenant_id, segment);
create index if not exists customers_tags_gin_idx on public.customers using gin (tags);
create index if not exists customers_preferred_professional_idx
  on public.customers (tenant_id, preferred_professional_id);

comment on column public.customers.preferred_professional_id is
  'ADR-08: profissional preferido (mesmo tenant; SET NULL).';
comment on column public.customers.tags is
  'ADR-08: etiquetas livres p/ filtro/segmentacao (ficha 360).';
comment on column public.customers.lgpd_consent_at is
  'ADR-08: quando o consentimento LGPD foi registrado (UTC; via RPC auditada).';

-- ============================================================================
-- 2. customer_notes — notas 1:N com visibilidade por papel.
-- ============================================================================
create table if not exists public.customer_notes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  customer_id         uuid not null,
  author_profile_id   uuid references public.profiles (id) on delete set null,
  author_role         text not null
    check (author_role in ('admin','receptionist','professional')),
  visibility          text not null default 'operational'
    check (visibility in ('operational','admin','appointment')),
  appointment_id      uuid,
  body                text not null check (char_length(body) between 1 and 2000),
  created_at          timestamptz not null default now(),
  constraint customer_notes_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete cascade,
  constraint customer_notes_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete cascade,
  constraint customer_notes_tenant_id_unique unique (tenant_id, id),
  -- operational/admin nao carregam atendimento; appointment exige o vinculo.
  constraint customer_notes_appointment_visibility_chk
    check (
      (visibility = 'appointment' and appointment_id is not null)
      or (visibility in ('operational','admin') and appointment_id is null)
    )
);

create index if not exists customer_notes_customer_created_idx
  on public.customer_notes (tenant_id, customer_id, created_at desc);
create index if not exists customer_notes_appointment_idx
  on public.customer_notes (tenant_id, appointment_id) where appointment_id is not null;

alter table public.customer_notes enable row level security;

-- SELECT por papel (ADR-08 §2): admin tudo; recepcao so operational;
-- professional so appointment do proprio atendimento.
drop policy if exists customer_notes_select_by_role on public.customer_notes;
create policy customer_notes_select_by_role on public.customer_notes for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'admin'
      or (current_role_name() = 'receptionist' and visibility = 'operational')
      or (
        current_role_name() = 'professional'
        and visibility = 'appointment'
        and exists (
          select 1 from public.appointments a
          join public.professionals p
            on p.tenant_id = a.tenant_id
           and p.id = a.professional_id
         where a.tenant_id = customer_notes.tenant_id
           and a.id = customer_notes.appointment_id
           and p.profile_id = auth.uid()
        )
      )
    )
  );

-- INSERT por papel: admin qualquer visibilidade; recepcao so operational sem
-- atendimento; professional so appointment com atendimento proprio.
drop policy if exists customer_notes_insert_by_role on public.customer_notes;
create policy customer_notes_insert_by_role on public.customer_notes for insert
  with check (
    tenant_id = current_tenant_id()
    and (
      (current_role_name() = 'admin')
      or (
        current_role_name() = 'receptionist'
        and visibility = 'operational'
        and appointment_id is null
      )
      or (
        current_role_name() = 'professional'
        and visibility = 'appointment'
        and appointment_id is not null
        and exists (
          select 1 from public.appointments a
          join public.professionals p
            on p.tenant_id = a.tenant_id
           and p.id = a.professional_id
         where a.tenant_id = customer_notes.tenant_id
           and a.id = customer_notes.appointment_id
           and a.customer_id = customer_notes.customer_id
           and p.profile_id = auth.uid()
        )
      )
    )
  );

-- UPDATE: autor operacional edita corpo; admin tudo. Colunas de vinculo sao
-- imutaveis via trigger (abaixo).
drop policy if exists customer_notes_update_by_role on public.customer_notes;
create policy customer_notes_update_by_role on public.customer_notes for update
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'admin'
      or (current_role_name() = 'receptionist' and visibility = 'operational')
      or (
        current_role_name() = 'professional'
        and visibility = 'appointment'
        and author_profile_id = auth.uid()
      )
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'admin'
      or (current_role_name() = 'receptionist' and visibility = 'operational')
      or (
        current_role_name() = 'professional'
        and visibility = 'appointment'
        and author_profile_id = auth.uid()
      )
    )
  );

-- DELETE: so admin (sem DELETE fisico pela app nos demais papeis).
drop policy if exists customer_notes_delete_admin on public.customer_notes;
create policy customer_notes_delete_admin on public.customer_notes for delete
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

-- Autoria carimbada no banco (nunca do cliente) + vinculo imutavel.
create or replace function public.customer_notes_set_author()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if current_role_name() not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  new.author_profile_id := auth.uid();
  new.author_role := current_role_name();
  new.tenant_id := coalesce(new.tenant_id, current_tenant_id());
  return new;
end;
$$;

drop trigger if exists customer_notes_set_author on public.customer_notes;
create trigger customer_notes_set_author
  before insert on public.customer_notes
  for each row execute function public.customer_notes_set_author();

create or replace function public.customer_notes_immutable_link()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.customer_id is distinct from old.customer_id
     or new.appointment_id is distinct from old.appointment_id
     or new.visibility is distinct from old.visibility
     or new.author_profile_id is distinct from old.author_profile_id then
    raise exception 'NOTE_LINK_IMMUTABLE' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_notes_immutable_link on public.customer_notes;
create trigger customer_notes_immutable_link
  before update on public.customer_notes
  for each row execute function public.customer_notes_immutable_link();

comment on table public.customer_notes is
  'ADR-08: notas do cliente com visibilidade por papel (operational|admin|appointment).';

-- ============================================================================
-- 3. RPCs — ficha 360 (SECURITY DEFINER; tenant da LINHA; papel explicito).
-- ============================================================================

-- 3a. customer_summary — no-show count, ultima visita, ticket medio (admin only).
create or replace function public.customer_summary(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role       text;
  v_cust       public.customers%rowtype;
  v_no_show    int := 0;
  v_concluded  int := 0;
  v_last_visit timestamptz;
  v_paid       int := 0;
  v_avg        int;
  v_loyalty    int;
begin
  if p_customer_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_cust from public.customers where id = p_customer_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
  end if;

  if auth.uid() is not null then
    v_role := public.current_role_name();
    if v_role not in ('admin','receptionist','professional') then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
    if v_cust.tenant_id is distinct from public.current_tenant_id() then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
    end if;
    if v_role = 'professional' and not exists (
      select 1 from public.appointments a
      join public.professionals p
        on p.tenant_id = a.tenant_id and p.id = a.professional_id
     where a.tenant_id = v_cust.tenant_id
       and a.customer_id = v_cust.id
       and p.profile_id = auth.uid()
    ) then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  else
    v_role := 'service_role';
  end if;

  select count(*) filter (where status = 'nao_compareceu'),
         count(*) filter (where status = 'concluido'),
         max(starts_at) filter (where status = 'concluido')
    into v_no_show, v_concluded, v_last_visit
    from public.appointments
   where tenant_id = v_cust.tenant_id
     and customer_id = v_cust.id;

  -- Financeiro: SOMENTE admin (ou service_role p/ Edge). Demais papeis: null.
  if v_role in ('admin','service_role') then
    select coalesce(sum(p.amount_cents), 0)
      into v_paid
      from public.appointment_payments p
      join public.appointments a
        on a.tenant_id = p.tenant_id and a.id = p.appointment_id
     where p.tenant_id = v_cust.tenant_id
       and a.customer_id = v_cust.id
       and p.voided_at is null;
    if v_concluded > 0 then
      v_avg := v_paid / v_concluded;
    else
      v_avg := null;
    end if;
  else
    v_paid := null;
    v_avg := null;
  end if;

  -- Fidelidade (ADR-06/07): saldo quando o tenant tem o entitlement; senao null.
  -- Sem quebrar a ficha quando o modulo nao existe/nao tem direito.
  v_loyalty := null;
  if public.tenant_has_feature(v_cust.tenant_id, 'fidelidade') then
    select la.balance_points into v_loyalty
      from public.loyalty_accounts la
     where la.tenant_id = v_cust.tenant_id
       and la.customer_id = v_cust.id;
  end if;

  return jsonb_build_object(
    'customer_id', v_cust.id,
    'tenant_id', v_cust.tenant_id,
    'name', v_cust.name,
    'segment', v_cust.segment,
    'tags', coalesce(v_cust.tags, '{}'::text[]),
    'preferred_professional_id', v_cust.preferred_professional_id,
    'preferred_time_window', v_cust.preferred_time_window,
    'notes_summary', v_cust.notes_summary,
    'whatsapp_opt_in', v_cust.whatsapp_opt_in,
    'whatsapp_opt_in_at', v_cust.whatsapp_opt_in_at,
    'lgpd_consent_at', v_cust.lgpd_consent_at,
    'lgpd_consent_version', v_cust.lgpd_consent_version,
    'no_show_count', v_no_show,
    'concluded_count', v_concluded,
    'last_visit_at', v_last_visit,
    'total_paid_cents', v_paid,
    'avg_ticket_cents', v_avg,
    'loyalty_balance_points', v_loyalty
  );
end;
$$;

-- 3b. customer_history — atendimentos paginados; valores so admin.
create or replace function public.customer_history(
  p_customer_id uuid,
  p_page int default 1,
  p_page_size int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role   text;
  v_cust   public.customers%rowtype;
  v_page   int := greatest(coalesce(p_page, 1), 1);
  v_size   int := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total  int := 0;
  v_items  jsonb := '[]'::jsonb;
begin
  if p_customer_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_cust from public.customers where id = p_customer_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
  end if;

  if auth.uid() is not null then
    v_role := public.current_role_name();
    if v_role not in ('admin','receptionist','professional') then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
    if v_cust.tenant_id is distinct from public.current_tenant_id() then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
    end if;
    if v_role = 'professional' and not exists (
      select 1 from public.appointments a
      join public.professionals p
        on p.tenant_id = a.tenant_id and p.id = a.professional_id
     where a.tenant_id = v_cust.tenant_id
       and a.customer_id = v_cust.id
       and p.profile_id = auth.uid()
    ) then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  else
    v_role := 'service_role';
  end if;

  select count(*) into v_total
    from public.appointments
   where tenant_id = v_cust.tenant_id
     and customer_id = v_cust.id;

  select coalesce(jsonb_agg(t.item order by t.starts_at desc), '[]'::jsonb)
    into v_items
    from (
      select jsonb_build_object(
               'id', a.id,
               'starts_at', a.starts_at,
               'ends_at', a.ends_at,
               'status', a.status,
               'service_name', s.name,
               'professional_id', a.professional_id,
               'price_cents', case when v_role in ('admin','service_role')
                                   then a.price_cents else null end
             ) as item,
             a.starts_at
        from public.appointments a
        join public.services s
          on s.tenant_id = a.tenant_id and s.id = a.service_id
       where a.tenant_id = v_cust.tenant_id
         and a.customer_id = v_cust.id
       order by a.starts_at desc
       limit v_size offset (v_page - 1) * v_size
    ) t;

  return jsonb_build_object(
    'customer_id', v_cust.id,
    'page', v_page,
    'page_size', v_size,
    'total', v_total,
    'items', v_items
  );
end;
$$;

-- 3c. customer_filter — tag/segmento/no-show minimo/opt-in; sem financeiro.
create or replace function public.customer_filter(
  p_tag text default null,
  p_segment text default null,
  p_no_show_min int default null,
  p_opt_in boolean default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role   text;
  v_tenant uuid;
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_items  jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null then
    v_role := public.current_role_name();
    if v_role not in ('admin','receptionist','professional') then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
    v_tenant := public.current_tenant_id();
  else
    v_role := 'service_role';
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select coalesce(jsonb_agg(t.item order by t.name), '[]'::jsonb)
    into v_items
    from (
      select jsonb_build_object(
               'customer_id', c.id,
               'name', c.name,
               'segment', c.segment,
               'tags', coalesce(c.tags, '{}'::text[]),
               'whatsapp_opt_in', c.whatsapp_opt_in,
               'no_show_count', (
                 select count(*)
                   from public.appointments a
                  where a.tenant_id = c.tenant_id
                    and a.customer_id = c.id
                    and a.status = 'nao_compareceu'
               )
             ) as item,
             c.name
        from public.customers c
       where c.tenant_id = v_tenant
         and (p_tag is null or p_tag = any (coalesce(c.tags, '{}'::text[])))
         and (p_segment is null or c.segment = p_segment)
         and (p_opt_in is null or c.whatsapp_opt_in = p_opt_in)
         and (
           p_no_show_min is null
           or (
             select count(*)
               from public.appointments a
              where a.tenant_id = c.tenant_id
                and a.customer_id = c.id
                and a.status = 'nao_compareceu'
           ) >= p_no_show_min
         )
       order by c.name
       limit v_limit offset v_offset
    ) t;

  return jsonb_build_object('items', v_items, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- 3d. customer_consent_update — opt-in + timestamps + versao + audit_log.
create or replace function public.customer_consent_update(
  p_customer_id uuid,
  p_opt_in boolean,
  p_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_cust public.customers%rowtype;
begin
  if p_customer_id is null or p_opt_in is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if p_version is not null
     and (char_length(p_version) < 1 or char_length(p_version) > 40) then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_cust from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
  end if;

  if auth.uid() is not null then
    v_role := public.current_role_name();
    if v_role not in ('admin','receptionist','professional') then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
    if v_cust.tenant_id is distinct from public.current_tenant_id() then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
    end if;
  else
    v_role := 'service_role';
  end if;

  update public.customers
     set whatsapp_opt_in = p_opt_in,
         whatsapp_opt_in_at = now(),
         lgpd_consent_at = case when p_opt_in then now() else lgpd_consent_at end,
         lgpd_consent_version = case when p_opt_in then p_version else lgpd_consent_version end
   where tenant_id = v_cust.tenant_id
     and id = v_cust.id
  returning * into v_cust;

  -- Auditoria sem PII: so ids + decisao (nunca telefone/nome no log).
  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_cust.tenant_id, auth.uid(), 'customer_consent_updated', 'customer', v_cust.id,
    jsonb_build_object(
      'opt_in', p_opt_in,
      'version', p_version
    )
  );

  return jsonb_build_object(
    'customer_id', v_cust.id,
    'whatsapp_opt_in', v_cust.whatsapp_opt_in,
    'whatsapp_opt_in_at', v_cust.whatsapp_opt_in_at,
    'lgpd_consent_at', v_cust.lgpd_consent_at,
    'lgpd_consent_version', v_cust.lgpd_consent_version
  );
end;
$$;

-- 3e. customer_can_receive_whatsapp — gate de disparo (opt-in + ativo).
create or replace function public.customer_can_receive_whatsapp(p_customer_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean := false;
begin
  if p_customer_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select (c.whatsapp_opt_in is true and c.active is true)
    into v_ok
    from public.customers c
   where c.id = p_customer_id
     and (
       auth.uid() is null
       or (c.tenant_id = public.current_tenant_id()
           and public.current_role_name() in ('admin','receptionist','professional'))
     );

  return coalesce(v_ok, false);
end;
$$;

-- Grants: app (authenticated) + Edge Functions (service_role). Nada p/ anon.
revoke all on function public.customer_summary(uuid) from public, anon;
grant execute on function public.customer_summary(uuid) to authenticated, service_role;

revoke all on function public.customer_history(uuid, int, int) from public, anon;
grant execute on function public.customer_history(uuid, int, int) to authenticated, service_role;

revoke all on function public.customer_filter(text, text, int, boolean, int, int) from public, anon;
grant execute on function public.customer_filter(text, text, int, boolean, int, int) to authenticated, service_role;

revoke all on function public.customer_consent_update(uuid, boolean, text) from public, anon;
grant execute on function public.customer_consent_update(uuid, boolean, text) to authenticated, service_role;

revoke all on function public.customer_can_receive_whatsapp(uuid) from public, anon;
grant execute on function public.customer_can_receive_whatsapp(uuid) to authenticated, service_role;

comment on function public.customer_summary(uuid) is
  'ADR-08: ficha 360 — resumo do cliente; financeiro (total/avg) so admin/service_role.';
comment on function public.customer_consent_update(uuid, boolean, text) is
  'ADR-08: registra opt-in + timestamps + versao LGPD com audit_log.';
comment on function public.customer_can_receive_whatsapp(uuid) is
  'ADR-08: gate de disparo — true so com opt-in + cliente ativo.';
