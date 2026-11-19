-- Migration: waitlist (ADR-04 Fase 4) — lista de espera: tabela, fila, oferta, idempotência.
-- Escopo: tabela `waitlist_entries` + RLS/RBAC + RPCs de fila/oferta/resposta/gestão.
-- Não entra: UI, campanhas/fidelidade, motor de notificação (oferta expõe whatsapp_opt_in;
-- o disparo usa o canal existente). Gating por entitlement `waitlist` é UI (mesma decisão da
-- ADR-02: RLS não depende de entitlement; sem entitlement a rota some e nenhuma escrita parte).
--
-- Status (pt-BR, espelha appointments): aguardando|ofertado|confirmado|recusado|expirado|
-- atendido|cancelado. `cancelado` = remoção manual com trilha (sem DELETE físico, P6).
-- Dinheiro: sem valores aqui (preço snapshot na confirmação, em price_cents do appointment).
-- Tempo: timestamptz UTC; countdown default 30 min (pergunta 5 do PRD em aberto — param).
--
-- Concorrência: pick com FOR UPDATE SKIP LOCKED + exclusion constraint de appointments
-- (23P01) como trava final na confirmação; replay por chave de evento não duplica oferta.
-- RPCs SECURITY DEFINER (precisam gravar audit_log, sem policy de escrita p/ authenticated)
-- com tenant derivado de current_tenant_id() em TODA query + gate de papel explícito
-- (PT403). search_path fixo. Idempotente (if not exists / or replace / drop policy if exists).

-- ============================================================================
-- 1. Tabela.
-- ============================================================================
create table if not exists public.waitlist_entries (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  customer_id             uuid not null,
  service_id              uuid not null,
  professional_id         uuid,
  desired_start_from      timestamptz not null,
  desired_start_to        timestamptz not null
    check (desired_start_to > desired_start_from),
  priority                int not null default 0 check (priority >= 0),
  expires_at              timestamptz,
  status                  text not null default 'aguardando'
    check (status in ('aguardando','ofertado','confirmado','recusado','expirado','atendido','cancelado')),
  offered_slot_start      timestamptz,
  offered_slot_end        timestamptz,
  offered_professional_id uuid,
  offer_expires_at        timestamptz,
  offered_by_event        text,
  offered_appointment_id  uuid,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint waitlist_entries_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint waitlist_entries_service_fk
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete restrict,
  constraint waitlist_entries_professional_fk
    foreign key (tenant_id, professional_id)
    references public.professionals (tenant_id, id) on delete restrict,
  constraint waitlist_entries_offered_professional_fk
    foreign key (tenant_id, offered_professional_id)
    references public.professionals (tenant_id, id) on delete restrict,
  constraint waitlist_entries_appointment_fk
    foreign key (tenant_id, offered_appointment_id)
    references public.appointments (tenant_id, id) on delete restrict
);

create index if not exists waitlist_entries_tenant_id_idx
  on public.waitlist_entries (tenant_id);
create index if not exists waitlist_entries_tenant_status_idx
  on public.waitlist_entries (tenant_id, status);
create index if not exists waitlist_entries_tenant_service_status_idx
  on public.waitlist_entries (tenant_id, service_id, status);
-- Fila: primeiro elegível (prioridade desc, created_at asc) entre aguardando.
create index if not exists waitlist_entries_queue_idx
  on public.waitlist_entries (tenant_id, service_id, priority desc, created_at asc)
  where status = 'aguardando';
create index if not exists waitlist_entries_event_idx
  on public.waitlist_entries (tenant_id, offered_by_event)
  where offered_by_event is not null;
-- Idempotência de enfileiramento: cobre professional_id nulo via coalesce com
-- sentinela (NULL é distinto em índice único; sem coalesce, corrida concorrente
-- com professional_id NULL duplicava). Sentinela nunca é id real (gen_random_uuid).
create unique index if not exists waitlist_entries_no_dup_active_idx
  on public.waitlist_entries
    (tenant_id, customer_id, service_id,
     coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid),
     desired_start_from, desired_start_to)
  where status in ('aguardando','ofertado');

-- ============================================================================
-- 2. RLS/RBAC (espelha appointments): admin/recepção tudo do tenant;
-- professional lê só entradas do próprio professional; escrita só staff.
-- ============================================================================
alter table public.waitlist_entries enable row level security;

drop policy if exists waitlist_entries_select_tenant on public.waitlist_entries;
create policy waitlist_entries_select_tenant on public.waitlist_entries for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() in ('admin','receptionist')
      or (
        current_role_name() = 'professional'
        and professional_id in (
          select p.id from public.professionals p
          where p.tenant_id = current_tenant_id()
            and p.profile_id = auth.uid()
        )
      )
    )
  );

drop policy if exists waitlist_entries_write_staff on public.waitlist_entries;
-- Sem DELETE direto: remoção física proibida (P6 — cancelado com trilha via RPC).
-- Escritas diretas limitadas a INSERT/UPDATE de staff; DELETE só via RPC
-- (que nunca deleta) — sem policy de DELETE, direct delete nega por RLS.
-- RPCs SECURITY DEFINER (owner) bypassam RLS e seguem auditados.
drop policy if exists waitlist_entries_insert_staff on public.waitlist_entries;
create policy waitlist_entries_insert_staff on public.waitlist_entries for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  );

drop policy if exists waitlist_entries_update_staff on public.waitlist_entries;
create policy waitlist_entries_update_staff on public.waitlist_entries for update
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  );

-- Rede final anti-DELETE físico (vale p/ owner e staff; RPCs não deletam).
create or replace function public.waitlist_entries_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists waitlist_entries_no_hard_delete on public.waitlist_entries;
create trigger waitlist_entries_no_hard_delete
  before delete on public.waitlist_entries
  for each row execute function public.waitlist_entries_no_hard_delete();

-- ============================================================================
-- 3. Helper interno: escolhe e marca o primeiro elegível (sem gate de papel;
-- chamadores públicos validam). Retorna o id ofertado ou null.
-- Replay: retorna o id da linha já ofertada pela chave (terminal ou ativa);
-- o status vem do chamador público (wrapper retorna `status` junto) — id
-- sozinho não distingue terminal de ativa por desenho (interno, sem grants).
-- ============================================================================
create or replace function public.waitlist__offer_next(
  v_tenant_id uuid,
  v_actor_id uuid,
  v_service_id uuid,
  v_professional_id uuid,
  v_slot_start timestamptz,
  v_slot_end timestamptz,
  v_countdown_minutes int,
  v_event_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.waitlist_entries%rowtype;
  v_countdown int := coalesce(v_countdown_minutes, 30);
begin
  if v_countdown <= 0 then
    v_countdown := 30;
  end if;

  -- Replay por chave de evento: slot já ofertado não gera segunda oferta.
  if v_event_key is not null then
    select * into v_entry
      from public.waitlist_entries
     where tenant_id = v_tenant_id
       and offered_by_event = v_event_key
     limit 1;
    if found then
      return v_entry.id;
    end if;
  end if;

  select * into v_entry
    from public.waitlist_entries
   where tenant_id = v_tenant_id
     and status = 'aguardando'
     and service_id = v_service_id
     and (v_professional_id is null
          or professional_id = v_professional_id
          or professional_id is null)
     and (expires_at is null or expires_at > now())
     and v_slot_start < desired_start_to
     and v_slot_end > desired_start_from
   order by priority desc, created_at asc
   limit 1
   for update skip locked;

  if not found then
    return null;
  end if;

  update public.waitlist_entries
     set status = 'ofertado',
         offered_slot_start = v_slot_start,
         offered_slot_end = v_slot_end,
         offered_professional_id = v_professional_id,
         offer_expires_at = now() + (v_countdown || ' minutes')::interval,
         offered_by_event = coalesce(v_event_key, offered_by_event),
         updated_at = now()
   where tenant_id = v_tenant_id
     and id = v_entry.id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant_id, v_actor_id, 'waitlist_offered', 'waitlist_entry', v_entry.id,
    jsonb_build_object(
      'event_key', v_event_key,
      'slot_start', v_slot_start,
      'slot_end', v_slot_end,
      'countdown_minutes', v_countdown
    )
  );

  return v_entry.id;
end;
$$;

revoke all on function public.waitlist__offer_next(uuid, uuid, uuid, uuid, timestamptz, timestamptz, int, text)
  from public, anon, authenticated;

-- ============================================================================
-- 4. RPCs públicos (SECURITY DEFINER + gate de papel; tenant sempre do JWT).
-- ============================================================================

-- Enfileira (idempotente: duplicata ativa retorna a existente com replayed=true).
create or replace function public.waitlist_enqueue(
  p_customer_id uuid,
  p_service_id uuid,
  p_professional_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_priority int default 0,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_entry public.waitlist_entries%rowtype;
begin
  if v_role not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_customer_id is null or p_service_id is null
     or p_from is null or p_to is null or p_to <= p_from then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if coalesce(p_priority, 0) < 0 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if not exists (select 1 from public.customers c
                  where c.tenant_id = v_tenant and c.id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
  end if;
  if not exists (select 1 from public.services s
                  where s.tenant_id = v_tenant and s.id = p_service_id) then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if p_professional_id is not null
     and not exists (select 1 from public.professionals p
                      where p.tenant_id = v_tenant and p.id = p_professional_id) then
    raise exception 'PROFESSIONAL_NOT_FOUND' using errcode = 'PT404';
  end if;

  select * into v_entry
    from public.waitlist_entries
   where tenant_id = v_tenant
     and customer_id = p_customer_id
     and service_id = p_service_id
     and ((professional_id = p_professional_id)
          or (professional_id is null and p_professional_id is null))
     and desired_start_from = p_from
     and desired_start_to = p_to
     and status in ('aguardando','ofertado')
   limit 1
   for update;

  if found then
    return jsonb_build_object('entry_id', v_entry.id, 'status', v_entry.status, 'replayed', true);
  end if;

  insert into public.waitlist_entries
    (tenant_id, customer_id, service_id, professional_id,
     desired_start_from, desired_start_to, priority, expires_at, created_by)
  values
    (v_tenant, p_customer_id, p_service_id, p_professional_id,
     p_from, p_to, coalesce(p_priority, 0), p_expires_at, auth.uid())
  returning * into v_entry;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'waitlist_enqueued', 'waitlist_entry', v_entry.id,
    jsonb_build_object(
      'customer_id', p_customer_id, 'service_id', p_service_id,
      'professional_id', p_professional_id, 'priority', coalesce(p_priority, 0)
    )
  );

  return jsonb_build_object('entry_id', v_entry.id, 'status', v_entry.status, 'replayed', false);
end;
$$;

-- Oferta ao primeiro elegível (slot liberado por cancelamento/no-show).
create or replace function public.waitlist_offer_next(
  p_service_id uuid,
  p_professional_id uuid default null,
  p_slot_start timestamptz default null,
  p_slot_end timestamptz default null,
  p_countdown_minutes int default 30,
  p_event_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_actor uuid := auth.uid();
  v_entry_id uuid;
  v_opt_in boolean;
  v_status text;
  v_replayed boolean := false;
begin
  if p_service_id is null or p_slot_start is null or p_slot_end is null
     or p_slot_end <= p_slot_start then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- service_role (job/Edge) pode ofertar sem papel de app; usuário exige staff.
  if v_actor is not null and v_role not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if v_tenant is null then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if p_event_key is not null then
    select e.id into v_entry_id
      from public.waitlist_entries e
     where e.tenant_id = v_tenant
       and e.offered_by_event = p_event_key
     limit 1;
    if found then
      v_replayed := true;
    end if;
  end if;

  if v_entry_id is null then
    v_entry_id := public.waitlist__offer_next(
      v_tenant, v_actor, p_service_id, p_professional_id,
      p_slot_start, p_slot_end, p_countdown_minutes, p_event_key
    );
  end if;

  if v_entry_id is null then
    return jsonb_build_object('entry_id', null, 'replayed', false, 'queued', false);
  end if;

  select e.status, coalesce(c.whatsapp_opt_in, false)
    into v_status, v_opt_in
    from public.waitlist_entries e
    join public.customers c
      on c.tenant_id = e.tenant_id and c.id = e.customer_id
   where e.tenant_id = v_tenant
     and e.id = v_entry_id;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'status', v_status,
    'replayed', v_replayed,
    'queued', true,
    'whatsapp_opt_in', v_opt_in
  );
end;
$$;

-- Resposta à oferta: aceitar cria o appointment; recusar passa ao próximo.
create or replace function public.waitlist_respond(
  p_entry_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_actor uuid := auth.uid();
  v_entry public.waitlist_entries%rowtype;
  v_service public.services%rowtype;
  v_professional_id uuid;
  v_appointment_id uuid;
  v_next_id uuid;
begin
  if v_role not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_entry_id is null or p_accept is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_entry
    from public.waitlist_entries
   where tenant_id = v_tenant
     and id = p_entry_id
   for update;

  if not found then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_entry.status <> 'ofertado' then
    raise exception 'ENTRY_NOT_OFFERED' using errcode = 'PT409';
  end if;

  -- Oferta vencida: expira e passa ao próximo (idempotente).
  -- Desenho: RAISE desfaz UPDATE+audit+offer_next (tudo na mesma transação),
  -- então NÃO há raise aqui — retorna terminal `expirado` com next_entry_id
  -- (Edge/API mapeia status=expirado → 409 OFFER_EXPIRED; segunda chamada no
  -- mesmo id cai em ENTRY_NOT_OFFERED/PT409 pois já não está ofertado).
  -- Repasse sempre com event_key NULL (nunca a chave da linha corrente:
  -- reusar a própria chave faria replay retornar a linha recém-expirada).
  if v_entry.offer_expires_at is not null and v_entry.offer_expires_at < now() then
    update public.waitlist_entries
       set status = 'expirado', updated_at = now()
     where tenant_id = v_tenant and id = v_entry.id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (v_tenant, v_actor, 'waitlist_expired', 'waitlist_entry', v_entry.id,
            jsonb_build_object('reason', 'offer_lapsed_on_respond'));

    v_next_id := public.waitlist__offer_next(
      v_tenant, v_actor, v_entry.service_id, v_entry.offered_professional_id,
      v_entry.offered_slot_start, v_entry.offered_slot_end, 30, null
    );

    return jsonb_build_object(
      'entry_id', v_entry.id, 'status', 'expirado',
      'expired', true, 'next_entry_id', v_next_id
    );
  end if;

  if p_accept then
    v_professional_id := coalesce(v_entry.professional_id, v_entry.offered_professional_id);
    if v_professional_id is null then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    select * into v_service
      from public.services
     where tenant_id = v_tenant and id = v_entry.service_id;
    if not found then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
    end if;

    -- Trava final anti-sobreposição: exclusion constraint levanta 23P01 em conflito.
    insert into public.appointments
      (tenant_id, customer_id, professional_id, service_id,
       starts_at, ends_at, price_cents, status)
    values
      (v_tenant, v_entry.customer_id, v_professional_id, v_entry.service_id,
       v_entry.offered_slot_start, v_entry.offered_slot_end,
       coalesce(v_service.price_cents, 0), 'pendente')
    returning id into v_appointment_id;

    update public.waitlist_entries
       set status = 'confirmado',
           offered_appointment_id = v_appointment_id,
           updated_at = now()
     where tenant_id = v_tenant and id = v_entry.id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (v_tenant, v_actor, 'waitlist_confirmed', 'waitlist_entry', v_entry.id,
            jsonb_build_object('appointment_id', v_appointment_id));

    return jsonb_build_object(
      'entry_id', v_entry.id, 'status', 'confirmado',
      'appointment_id', v_appointment_id, 'next_entry_id', null
    );
  else
    update public.waitlist_entries
       set status = 'recusado', updated_at = now()
     where tenant_id = v_tenant and id = v_entry.id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (v_tenant, v_actor, 'waitlist_declined', 'waitlist_entry', v_entry.id,
            jsonb_build_object('slot_start', v_entry.offered_slot_start));

    v_next_id := public.waitlist__offer_next(
      v_tenant, v_actor, v_entry.service_id, v_entry.offered_professional_id,
      v_entry.offered_slot_start, v_entry.offered_slot_end, 30, null
    );

    return jsonb_build_object(
      'entry_id', v_entry.id, 'status', 'recusado', 'next_entry_id', v_next_id
    );
  end if;
end;
$$;

-- Expiração (job/lazy): ofertas vencidas viram expirado e passam ao próximo.
-- Gate espelha waitlist_offer_next: usuário exige staff (admin/receptionist);
-- service_role (v_actor null, job/Edge) varre global; com JWT, escopo por tenant.
create or replace function public.waitlist_expire_due(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_role text := current_role_name();
  v_actor uuid := auth.uid();
  v_count int := 0;
  v_row record;
  v_next uuid;
begin
  if v_actor is not null and v_role not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if v_actor is not null and v_tenant is null then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_limit is null or p_limit <= 0 then
    p_limit := 100;
  end if;

  for v_row in
    select e.id, e.tenant_id, e.service_id, e.offered_professional_id,
           e.offered_slot_start, e.offered_slot_end, e.offered_by_event
      from public.waitlist_entries e
     where e.status = 'ofertado'
       and e.offer_expires_at is not null
       and e.offer_expires_at < now()
       and (v_actor is null or e.tenant_id = v_tenant)
     order by e.offer_expires_at asc
     limit p_limit
     for update skip locked
  loop
    update public.waitlist_entries
       set status = 'expirado', updated_at = now()
     where tenant_id = v_row.tenant_id and id = v_row.id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (v_row.tenant_id, v_actor, 'waitlist_expired', 'waitlist_entry', v_row.id,
            jsonb_build_object('reason', 'offer_countdown_lapsed'));

    v_next := public.waitlist__offer_next(
      v_row.tenant_id, v_actor, v_row.service_id, v_row.offered_professional_id,
      v_row.offered_slot_start, v_row.offered_slot_end, 30, null
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Gestão manual: prioridade (fila), remoção (cancelado), atendida, expiração.
create or replace function public.waitlist_set_priority(p_entry_id uuid, p_priority int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_entry public.waitlist_entries%rowtype;
begin
  if current_role_name() not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_entry_id is null or p_priority is null or p_priority < 0 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_entry from public.waitlist_entries
   where tenant_id = v_tenant and id = p_entry_id
   for update;
  if not found then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_entry.status not in ('aguardando','ofertado') then
    raise exception 'ENTRY_NOT_ACTIVE' using errcode = 'PT409';
  end if;

  update public.waitlist_entries
     set priority = p_priority, updated_at = now()
   where tenant_id = v_tenant and id = p_entry_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (v_tenant, auth.uid(), 'waitlist_reordered', 'waitlist_entry', p_entry_id,
          jsonb_build_object('priority', p_priority, 'from', v_entry.priority));

  return jsonb_build_object('entry_id', p_entry_id, 'priority', p_priority);
end;
$$;

create or replace function public.waitlist_remove(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_entry public.waitlist_entries%rowtype;
begin
  if current_role_name() not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_entry_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_entry from public.waitlist_entries
   where tenant_id = v_tenant and id = p_entry_id
   for update;
  if not found then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_entry.status in ('confirmado','atendido','cancelado') then
    raise exception 'ENTRY_NOT_ACTIVE' using errcode = 'PT409';
  end if;

  update public.waitlist_entries
     set status = 'cancelado', updated_at = now()
   where tenant_id = v_tenant and id = p_entry_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (v_tenant, auth.uid(), 'waitlist_removed', 'waitlist_entry', p_entry_id,
          jsonb_build_object('from', v_entry.status));

  return jsonb_build_object('entry_id', p_entry_id, 'status', 'cancelado');
end;
$$;

create or replace function public.waitlist_mark_attended(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_entry public.waitlist_entries%rowtype;
begin
  if current_role_name() not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_entry_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_entry from public.waitlist_entries
   where tenant_id = v_tenant and id = p_entry_id
   for update;
  if not found then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_entry.status <> 'confirmado' then
    raise exception 'ENTRY_NOT_CONFIRMED' using errcode = 'PT409';
  end if;

  update public.waitlist_entries
     set status = 'atendido', updated_at = now()
   where tenant_id = v_tenant and id = p_entry_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (v_tenant, auth.uid(), 'waitlist_attended', 'waitlist_entry', p_entry_id,
          jsonb_build_object('appointment_id', v_entry.offered_appointment_id));

  return jsonb_build_object('entry_id', p_entry_id, 'status', 'atendido');
end;
$$;

create or replace function public.waitlist_mark_expired(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_entry public.waitlist_entries%rowtype;
begin
  if current_role_name() not in ('admin','receptionist') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_entry_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_entry from public.waitlist_entries
   where tenant_id = v_tenant and id = p_entry_id
   for update;
  if not found then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_entry.status not in ('aguardando','ofertado') then
    raise exception 'ENTRY_NOT_ACTIVE' using errcode = 'PT409';
  end if;

  update public.waitlist_entries
     set status = 'expirado', updated_at = now()
   where tenant_id = v_tenant and id = p_entry_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (v_tenant, auth.uid(), 'waitlist_expired', 'waitlist_entry', p_entry_id,
          jsonb_build_object('reason', 'manual', 'from', v_entry.status));

  return jsonb_build_object('entry_id', p_entry_id, 'status', 'expirado');
end;
$$;

-- Grants: RPCs públicos p/ authenticated (job usa service_role, bypassa RLS/grants).
revoke all on function public.waitlist_enqueue(uuid, uuid, uuid, timestamptz, timestamptz, int, timestamptz)
  from public, anon;
grant execute on function public.waitlist_enqueue(uuid, uuid, uuid, timestamptz, timestamptz, int, timestamptz)
  to authenticated;

revoke all on function public.waitlist_offer_next(uuid, uuid, timestamptz, timestamptz, int, text)
  from public, anon;
grant execute on function public.waitlist_offer_next(uuid, uuid, timestamptz, timestamptz, int, text)
  to authenticated;

revoke all on function public.waitlist_respond(uuid, boolean) from public, anon;
grant execute on function public.waitlist_respond(uuid, boolean) to authenticated;

revoke all on function public.waitlist_expire_due(int) from public, anon;
grant execute on function public.waitlist_expire_due(int) to authenticated;

revoke all on function public.waitlist_set_priority(uuid, int) from public, anon;
grant execute on function public.waitlist_set_priority(uuid, int) to authenticated;

revoke all on function public.waitlist_remove(uuid) from public, anon;
grant execute on function public.waitlist_remove(uuid) to authenticated;

revoke all on function public.waitlist_mark_attended(uuid) from public, anon;
grant execute on function public.waitlist_mark_attended(uuid) to authenticated;

revoke all on function public.waitlist_mark_expired(uuid) from public, anon;
grant execute on function public.waitlist_mark_expired(uuid) to authenticated;
