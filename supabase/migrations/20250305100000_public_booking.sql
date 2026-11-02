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
  v_slot_interval interval := interval '30 minutes';
begin
  -- Valida link
  select tenant_id, active into v_tenant_id, v_link_active
  from public_booking_links
  where token = p_token;

  if v_tenant_id is null or v_link_active is false then
    return;
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
    and day_of_week = v_day_of_week
    and active = true;

  if v_work_start is null then
    return;
  end if;

  -- Gera slots e filtra conflitos
  return query
  with slots as (
    select 
      (p_date + s.slot_time)::timestamptz as slot_start,
      (p_date + s.slot_time + (v_duration || ' minutes')::interval)::timestamptz as slot_end
    from generate_series(v_work_start, v_work_end - (v_duration || ' minutes')::interval, v_slot_interval) as s(slot_time)
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
