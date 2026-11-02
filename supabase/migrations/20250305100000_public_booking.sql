-- Migration: public_booking — autoagendamento público por link (ADR-19)
-- Fase 3 do PRD: link público permite cliente agendar sozinho.

-- Tabela de links públicos por tenant
create table if not exists public_booking_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint public_booking_links_token_key unique (token)
);

create index if not exists public_booking_links_tenant_idx on public_booking_links(tenant_id);
create index if not exists public_booking_links_token_idx on public_booking_links(token);

alter table public_booking_links enable row level security;

-- Apenas admin do tenant pode gerenciar links
drop policy if exists public_booking_links_admin_all on public_booking_links;
create policy public_booking_links_admin_all on public_booking_links for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

-- Nenhuma policy para público (anon) - acesso só via Edge Functions com service role

-- Função para buscar slots disponíveis (usada pela Edge Function)
create or replace function public_booking_get_slots(
  p_token uuid,
  p_service_id uuid,
  p_professional_id uuid,
  p_date date
)
returns table(
  slot_start timestamptz,
  slot_end timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_link_active boolean;
  v_duration int;
  v_professional_id uuid;
  v_day_of_week int;
  v_work_start time;
  v_work_end time;
  v_timezone text := 'America/Sao_Paulo';
  v_slot_interval interval := interval '30 minutes';
begin
  -- Valida link
  select tenant_id, active into v_tenant_id, v_link_active
  from public_booking_links
  where token = p_token;

  if v_tenant_id is null or v_link_active is false then
    return;
  end if;

  select timezone into v_timezone from tenants where id = v_tenant_id;
  if v_timezone is null then
    v_timezone := 'America/Sao_Paulo';
  end if;

  -- Valida serviço
  select duration_minutes into v_duration
  from services
  where id = p_service_id and tenant_id = v_tenant_id and active = true;

  if v_duration is null then
    return;
  end if;

  -- Valida profissional (se fornecido)
  if p_professional_id is not null then
    v_professional_id := p_professional_id;
    if not exists (
      select 1 from service_professionals sp
      where sp.tenant_id = v_tenant_id
        and sp.service_id = p_service_id
        and sp.professional_id = p_professional_id
    ) then
      return;
    end if;
  else
    -- Pega primeiro profissional disponível para o serviço
    select sp.professional_id into v_professional_id
    from service_professionals sp
    where sp.tenant_id = v_tenant_id and sp.service_id = p_service_id
    limit 1;
  end if;

  if v_professional_id is null then
    return;
  end if;

  -- Dia da semana (0=domingo, 1=segunda, ...)
  v_day_of_week := extract(dow from p_date);

  -- Horário de trabalho
  select start_time, end_time into v_work_start, v_work_end
  from working_hours
  where tenant_id = v_tenant_id
    and professional_id = v_professional_id
    and weekday = v_day_of_week
    ;

  if v_work_start is null then
    return;
  end if;

  -- Gera slots e filtra conflitos
  return query
  with slots as (
    select 
      ((p_date::timestamp + v_work_start + (n * v_slot_interval)) AT TIME ZONE v_timezone) as slot_start,
      ((p_date::timestamp + v_work_start + (n * v_slot_interval) + (v_duration || ' minutes')::interval) AT TIME ZONE v_timezone) as slot_end
    from generate_series(0, (extract(epoch from (v_work_end - v_work_start))::int - (v_duration * 60)) / extract(epoch from v_slot_interval)::int) as n
  )
  select sl.slot_start, sl.slot_end
  from slots sl
  where not exists (
    select 1 from appointments a
    where a.tenant_id = v_tenant_id
      and a.professional_id = v_professional_id
      and a.status not in ('cancelado')
      and a.starts_at < sl.slot_end
      and a.ends_at > sl.slot_start
  )
  and sl.slot_start > now()
  order by sl.slot_start;
end;
$$;

revoke all on function public_booking_get_slots(uuid, uuid, uuid, date) from public;
grant execute on function public_booking_get_slots(uuid, uuid, uuid, date) to anon, authenticated;

-- RPC para admin gerar/copiar link de autoagendamento
create or replace function create_public_booking_link()
returns table(token uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := current_tenant_id();
  
  if v_tenant_id is null then
    raise exception 'tenant_not_found';
  end if;
  
  if current_role_name() != 'admin' then
    raise exception 'forbidden';
  end if;
  
  -- Desativa links antigos se houver (um link ativo por tenant)
  update public_booking_links set active = false where tenant_id = v_tenant_id;
  
  -- Cria novo link
  return query
  insert into public_booking_links (tenant_id, active)
  values (v_tenant_id, true)
  returning public_booking_links.token, public_booking_links.created_at;
end;
$$;

revoke all on function create_public_booking_link() from public;
grant execute on function create_public_booking_link() to authenticated;

-- Atualiza RPC para mensagem mais clara
create or replace function create_public_booking_link()
returns table(token uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_role text;
begin
  v_tenant_id := current_tenant_id();
  v_role := current_role_name();
  
  if v_tenant_id is null then
    raise exception 'tenant_required';
  end if;
  
  if v_role != 'admin' then
    raise exception 'forbidden_admin_only';
  end if;
  
  update public_booking_links set active = false where tenant_id = v_tenant_id;
  
  return query
  insert into public_booking_links (tenant_id, active)
  values (v_tenant_id, true)
  returning public_booking_links.token, public_booking_links.created_at;
end;
$$;

revoke all on function create_public_booking_link() from public;
grant execute on function create_public_booking_link() to authenticated;

-- RPC para super admin gerar link por tenant
create or replace function create_public_booking_link(p_tenant_id uuid default null)
returns table(token uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_tenant_id uuid := p_tenant_id;
  v_role text;
  v_uid uuid := auth.uid();
  v_user_tenant uuid;
begin
  begin v_tenant_id := coalesce(v_tenant_id, current_tenant_id()); exception when others then null; end;
  begin v_role := current_role_name(); exception when others then v_role := null; end;

  if v_uid is not null then
    select p.tenant_id, lower(p.role)::text
      into v_user_tenant, v_role
    from public.profiles p
    where p.id = v_uid
    limit 1;
  end if;

  if v_role is null and v_uid is not null then
    select lower(coalesce(raw_app_meta_data->>'role','')) into v_role
    from auth.users where id = v_uid;
  end if;

  if lower(coalesce(v_role,'')) != 'super_admin' then
    v_tenant_id := coalesce(v_user_tenant, v_tenant_id);
  else
    v_tenant_id := coalesce(p_tenant_id, v_tenant_id, v_user_tenant);
  end if;

  if v_tenant_id is null then
    raise exception 'tenant_required';
  end if;

  if lower(coalesce(v_role,'')) not in ('admin','super_admin') then
    raise exception 'forbidden_admin_only';
  end if;

  update public_booking_links set active = false where tenant_id = v_tenant_id;

  return query
  insert into public_booking_links (tenant_id, active)
  values (v_tenant_id, true)
  returning public_booking_links.token, public_booking_links.created_at;
end;
$$;

revoke all on function create_public_booking_link(uuid) from public;
grant execute on function create_public_booking_link(uuid) to authenticated;
