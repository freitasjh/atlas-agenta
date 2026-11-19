-- ============================================================================
-- ADR-07 (roadmap-fase3/salao-barbearia) — Recursos agendáveis backend.
-- Tabelas resources, service_resources, appointment_resources + RPCs de conflito/
-- reserva/liberação/listagem + triggers de herança e guarda de conflito.
-- Multi-tenant: tenant_id do JWT, RLS. RBAC: admin escreve, receptionist/prof
-- leem conforme escopo.
-- ============================================================================

-- ============================================================================
-- 1. resources — sala/equipamento/cadeira agendável do tenant.
-- ============================================================================
create table if not exists public.resources (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default current_tenant_id()
               references public.tenants (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  type       text not null check (type in ('sala','equipamento','cadeira')),
  capacity   int  not null default 1 check (capacity >= 1),
  color      text,
  active     bool not null default true,
  created_at timestamptz not null default now(),
  constraint resources_tenant_id_unique unique (tenant_id, id)
);

create index if not exists resources_tenant_id_idx on public.resources (tenant_id);
create index if not exists resources_tenant_type_idx on public.resources (tenant_id, type);

alter table public.resources enable row level security;

drop policy if exists resources_select_same_tenant on public.resources;
create policy resources_select_same_tenant on public.resources for select
  using (tenant_id = current_tenant_id());

drop policy if exists resources_write_admin on public.resources;
create policy resources_write_admin on public.resources for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.resources from anon, authenticated;
grant select, insert, update, delete on table public.resources to authenticated;
grant all on table public.resources to service_role;

-- ============================================================================
-- 2. service_resources (N:N) — recursos exigidos por um serviço.
-- ============================================================================
create table if not exists public.service_resources (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default current_tenant_id()
                references public.tenants (id) on delete cascade,
  service_id  uuid not null,
  resource_id uuid not null,
  qty         int  not null default 1 check (qty >= 1),
  created_at  timestamptz not null default now(),
  constraint service_resources_service_fk
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete cascade,
  constraint service_resources_resource_fk
    foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete restrict,
  constraint service_resources_unique unique (tenant_id, service_id, resource_id)
);

create index if not exists service_resources_tenant_id_idx on public.service_resources (tenant_id);
create index if not exists service_resources_tenant_service_idx on public.service_resources (tenant_id, service_id);
create index if not exists service_resources_tenant_resource_idx on public.service_resources (tenant_id, resource_id);

alter table public.service_resources enable row level security;

drop policy if exists service_resources_select_same_tenant on public.service_resources;
create policy service_resources_select_same_tenant on public.service_resources for select
  using (tenant_id = current_tenant_id());

drop policy if exists service_resources_write_admin on public.service_resources;
create policy service_resources_write_admin on public.service_resources for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.service_resources from anon, authenticated;
grant select, insert, update, delete on table public.service_resources to authenticated;
grant all on table public.service_resources to service_role;

-- ============================================================================
-- 3. appointment_resources (N:N) — recursos reservados por atendimento.
-- Escrita direta negada (RLS sem policy de insert/update/delete): uso via RPC.
-- ============================================================================
create table if not exists public.appointment_resources (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default current_tenant_id()
                   references public.tenants (id) on delete cascade,
  appointment_id uuid not null,
  resource_id    uuid not null,
  qty            int  not null default 1 check (qty >= 1),
  created_at     timestamptz not null default now(),
  constraint appointment_resources_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete cascade,
  constraint appointment_resources_resource_fk
    foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete restrict,
  constraint appointment_resources_unique unique (tenant_id, appointment_id, resource_id)
);

create index if not exists appointment_resources_tenant_id_idx on public.appointment_resources (tenant_id);
create index if not exists appointment_resources_tenant_appointment_idx on public.appointment_resources (tenant_id, appointment_id);
create index if not exists appointment_resources_tenant_resource_idx on public.appointment_resources (tenant_id, resource_id);
create index if not exists appointment_resources_tenant_resource_appointment_idx on public.appointment_resources (tenant_id, resource_id, appointment_id);

alter table public.appointment_resources enable row level security;

drop policy if exists appointment_resources_select on public.appointment_resources;
create policy appointment_resources_select on public.appointment_resources for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() in ('admin','receptionist')
      or (
        current_role_name() = 'professional'
        and appointment_id in (
          select a.id
            from public.appointments a
            join public.professionals p
              on p.tenant_id = a.tenant_id and p.id = a.professional_id
           where p.profile_id = auth.uid()
        )
      )
    )
  );

-- Sem policies de escrita: insert/update/delete só via RPC (security definer) ou service_role.

revoke all on table public.appointment_resources from anon, authenticated;
grant select on table public.appointment_resources to authenticated;
grant all on table public.appointment_resources to service_role;

-- ============================================================================
-- 4. Funções auxiliares
-- ============================================================================
create or replace function public.check_resource_conflict(
  p_resource_id             uuid,
  p_starts_at               timestamptz,
  p_ends_at                 timestamptz,
  p_processing_minutes      int default 0,
  p_exclude_appointment_id  uuid default null,
  p_qty                     int default 1
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_capacity int;
  v_candidate_end timestamptz;
  v_used     int;
begin
  v_tenant := current_tenant_id();
  if v_tenant is null then
    raise exception 'RESOURCE_TENANT_REQUIRED' using errcode = '42501';
  end if;
  -- Lock da linha do recurso: serializa guardas de capacidade concorrentes
  -- (FOR UPDATE mantém o lock até o fim da transação).
  select capacity into v_capacity
    from public.resources
   where tenant_id = v_tenant and id = p_resource_id
     for update;
  if not found then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = '23503';
  end if;

  v_candidate_end := p_ends_at + (coalesce(p_processing_minutes, 0) * interval '1 minute');

  select coalesce(sum(ar.qty), 0) into v_used
    from public.appointment_resources ar
    join public.appointments a
      on a.tenant_id = ar.tenant_id and a.id = ar.appointment_id
   where ar.tenant_id = v_tenant
     and ar.resource_id = p_resource_id
     and (p_exclude_appointment_id is null or ar.appointment_id <> p_exclude_appointment_id)
     and a.status not in ('cancelado','nao_compareceu')
     and not (a.origin = 'walk_in' and a.status = 'concluido')
     and tstzrange(a.starts_at, a.ends_at + (coalesce(a.processing_minutes, 0) * interval '1 minute'), '[)') &&
         tstzrange(p_starts_at, v_candidate_end, '[)');

  return (v_used + coalesce(p_qty, 1)) > v_capacity;
end;
$$;

-- ============================================================================
-- 5. Triggers
-- ============================================================================
-- Guarda de conflito em appointments (BEFORE INSERT/UPDATE).
-- Regra de negócio: service_id é imutável por atendimento (cancelar/recriar para trocar).
-- O trigger cobre mudanças de starts_at/ends_at/status/service_id para reavaliar conflitos.
create or replace function public.appointments_resource_conflict_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource record;
  v_conflict boolean;
  v_processing int;
  v_service_processing int;
begin
  -- Imutabilidade de service_id: trocar serviço exige cancelar/recriar atendimento.
  if tg_op = 'UPDATE' and old.service_id is distinct from new.service_id then
    raise exception 'SERVICE_ID_IMMUTABLE' using errcode = 'check_violation';
  end if;

  if new.status in ('cancelado','nao_compareceu') then
    return new;
  end if;

  v_processing := new.processing_minutes;
  if v_processing is null and new.service_id is not null then
    select s.processing_minutes into v_service_processing
      from public.services s
     where s.tenant_id = new.tenant_id and s.id = new.service_id;
    v_processing := coalesce(v_service_processing, 0);
  end if;
  v_processing := coalesce(v_processing, 0);

  if tg_op = 'INSERT' then
    if new.service_id is not null then
      for v_resource in
        select sr.resource_id, sr.qty
          from public.service_resources sr
         where sr.tenant_id = new.tenant_id and sr.service_id = new.service_id
      loop
        select public.check_resource_conflict(
                 v_resource.resource_id, new.starts_at, new.ends_at, v_processing, null, v_resource.qty
               ) into v_conflict;
        if v_conflict then
          raise exception 'RESOURCE_CONFLICT'
            using errcode = '23P01';
        end if;
      end loop;
    end if;
  else
    -- UPDATE: verifica recursos já vinculados ao appointment.
    for v_resource in
      select ar.resource_id, ar.qty
        from public.appointment_resources ar
       where ar.tenant_id = new.tenant_id and ar.appointment_id = new.id
    loop
      select public.check_resource_conflict(
               v_resource.resource_id, new.starts_at, new.ends_at, v_processing, new.id, v_resource.qty
             ) into v_conflict;
      if v_conflict then
        raise exception 'RESOURCE_CONFLICT'
          using errcode = '23P01';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_resource_conflict_guard on public.appointments;
create trigger appointments_resource_conflict_guard
  before insert or update of starts_at, ends_at, status, service_id on public.appointments
  for each row
  execute function public.appointments_resource_conflict_guard();

-- Herança: ao criar appointment, herdar service_resources -> appointment_resources.
create or replace function public.appointments_inherit_resources()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Não herdar recursos para atendimentos já cancelados/não-comparecidos.
  if new.status in ('cancelado','nao_compareceu') then
    return new;
  end if;
  if new.service_id is not null then
    insert into public.appointment_resources (tenant_id, appointment_id, resource_id, qty)
    select new.tenant_id, new.id, sr.resource_id, sr.qty
      from public.service_resources sr
     where sr.tenant_id = new.tenant_id
       and sr.service_id = new.service_id
    on conflict (tenant_id, appointment_id, resource_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_inherit_resources on public.appointments;
create trigger appointments_inherit_resources
  after insert on public.appointments
  for each row
  execute function public.appointments_inherit_resources();

-- Guarda de conflito em appointment_resources (reserva manual).
create or replace function public.appointment_resources_conflict_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt record;
  v_conflict boolean;
begin
  select starts_at, ends_at, processing_minutes
    into v_appt
    from public.appointments
   where tenant_id = new.tenant_id and id = new.appointment_id;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = '23503';
  end if;

  select public.check_resource_conflict(
           new.resource_id, v_appt.starts_at, v_appt.ends_at, v_appt.processing_minutes,
           new.appointment_id, new.qty
         ) into v_conflict;
  if v_conflict then
    raise exception 'RESOURCE_CONFLICT' using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists appointment_resources_conflict_guard on public.appointment_resources;
create trigger appointment_resources_conflict_guard
  before insert or update on public.appointment_resources
  for each row
  execute function public.appointment_resources_conflict_guard();

-- ============================================================================
-- 6. RPCs
-- ============================================================================
create or replace function public.reserve_resource(
  p_resource_id    uuid,
  p_appointment_id uuid,
  p_qty            int default 1
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_role     text;
  v_qty      int;
  v_row_id   uuid;
  v_is_own   boolean;
  v_appt_status text;
begin
  v_tenant := current_tenant_id();
  v_role   := current_role_name();
  v_qty    := coalesce(p_qty, 1);
  if v_tenant is null then
    raise exception 'RESOURCE_TENANT_REQUIRED' using errcode = '42501';
  end if;
  if v_qty is null or v_qty < 1 then
    raise exception 'RESOURCE_QTY_INVALID' using errcode = '23514';
  end if;
  if coalesce(v_role,'__none') not in ('admin','receptionist','professional') then
    raise exception 'RESOURCE_RESERVE_DENIED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.resources where tenant_id = v_tenant and id = p_resource_id) then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = '23503';
  end if;
  -- Lock da linha do appointment antes das checagens de status/papel: serializa
  -- reservas concorrentes sobre o mesmo atendimento.
  select status into v_appt_status
    from public.appointments
   where tenant_id = v_tenant and id = p_appointment_id
     for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = '23503';
  end if;
  if v_appt_status in ('cancelado','nao_compareceu') then
    raise exception 'APPOINTMENT_FINAL_STATUS' using errcode = '23514';
  end if;

  if v_role = 'professional' then
    select exists (
      select 1 from public.appointments a
      join public.professionals p on p.tenant_id = a.tenant_id and p.id = a.professional_id
      where a.tenant_id = v_tenant and a.id = p_appointment_id and p.profile_id = auth.uid()
    ) into v_is_own;
    if not v_is_own then
      raise exception 'RESOURCE_RESERVE_DENIED' using errcode = '42501';
    end if;
  end if;

  insert into public.appointment_resources (tenant_id, appointment_id, resource_id, qty)
  values (v_tenant, p_appointment_id, p_resource_id, v_qty)
  on conflict (tenant_id, appointment_id, resource_id)
  do update set qty = excluded.qty
  returning id into v_row_id;

  return v_row_id;
end;
$$;

create or replace function public.release_resource(
  p_resource_id    uuid,
  p_appointment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_deleted int;
  v_is_own boolean;
begin
  v_tenant := current_tenant_id();
  v_role   := current_role_name();
  if v_tenant is null then
    raise exception 'RESOURCE_TENANT_REQUIRED' using errcode = '42501';
  end if;
  if coalesce(v_role,'__none') not in ('admin','receptionist','professional') then
    raise exception 'RESOURCE_RELEASE_DENIED' using errcode = '42501';
  end if;

  if v_role = 'professional' then
    select exists (
      select 1 from public.appointments a
      join public.professionals p on p.tenant_id = a.tenant_id and p.id = a.professional_id
      where a.tenant_id = v_tenant and a.id = p_appointment_id and p.profile_id = auth.uid()
    ) into v_is_own;
    if not v_is_own then
      raise exception 'RESOURCE_RELEASE_DENIED' using errcode = '42501';
    end if;
  end if;

  delete from public.appointment_resources
   where tenant_id = v_tenant
     and appointment_id = p_appointment_id
     and resource_id = p_resource_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

create or replace function public.list_appointments_by_resource(
  p_resource_id uuid,
  p_day         date,
  p_timezone    text default 'UTC'
)
returns table (
  appointment_id   uuid,
  starts_at        timestamptz,
  ends_at          timestamptz,
  processing_minutes int,
  status           text,
  customer_id      uuid,
  professional_id  uuid,
  service_id       uuid,
  qty              int
)
language sql
security invoker
set search_path = public
as $$
  select a.id, a.starts_at, a.ends_at, a.processing_minutes, a.status,
         a.customer_id, a.professional_id, a.service_id, ar.qty
    from public.appointments a
    join public.appointment_resources ar
      on ar.tenant_id = a.tenant_id and ar.appointment_id = a.id
   where a.tenant_id = current_tenant_id()
     and ar.resource_id = p_resource_id
     and (a.starts_at at time zone p_timezone)::date = p_day
   order by a.starts_at;
$$;

-- ============================================================================
-- 7. Grants
-- ============================================================================
revoke all on function public.check_resource_conflict(uuid, timestamptz, timestamptz, int, uuid, int) from public, anon;
grant execute on function public.check_resource_conflict(uuid, timestamptz, timestamptz, int, uuid, int) to authenticated, service_role;

revoke all on function public.reserve_resource(uuid, uuid, int) from public, anon;
grant execute on function public.reserve_resource(uuid, uuid, int) to authenticated, service_role;

revoke all on function public.release_resource(uuid, uuid) from public, anon;
grant execute on function public.release_resource(uuid, uuid) to authenticated, service_role;

revoke all on function public.list_appointments_by_resource(uuid, date, text) from public, anon;
grant execute on function public.list_appointments_by_resource(uuid, date, text) to authenticated, service_role;