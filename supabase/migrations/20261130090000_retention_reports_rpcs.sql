-- Migration: ADR-09 Fase 4 (F) — RPCs de relatórios de retenção (admin only).
-- Escopo: 6 RPCs de agregação sobre `appointments`/`working_hours` existentes; nenhuma
-- tabela nova (sem RLS nova — leitura confinada por tenant via queries com
-- `tenant_id = current_tenant_id()`). Não toca UI (ADR-17 gera CSV client-side do JSON).
--
-- Contrato:
--   report_noshow_rate(p_from, p_to, p_professional_id = null, p_service_id = null) → jsonb
--   report_rebooking_rate(p_from, p_to, p_professional_id = null, p_service_id = null) → jsonb
--   report_utilization(p_from, p_to, p_professional_id = null, p_service_id = null) → jsonb
--   report_ticket_medio(p_from, p_to, p_professional_id = null, p_service_id = null) → jsonb
--   report_cohort_retention(p_cohort_month, p_windows = '{30,60,90}') → jsonb
--   report_retention_summary(p_from, p_to) → jsonb
--   security invoker, search_path = public, pg_temp, sem p_tenant_id (deriva do JWT).
--   Só `admin` (PT403); período obrigatório com p_to > p_from e janela ≤ 366 dias (PT400).
--
-- Definições (resposta à pergunta 11 do PRD):
--   coorte = mês-calendário da PRIMEIRA visita concluída do cliente
--     (min(starts_at) com status = 'concluido'); janela N = dias corridos após a
--     primeira visita; retido em N = ≥1 concluído em (primeira_visita, primeira+N].
--   no-show rate = nao_compareceu ÷ (concluido + confirmado + nao_compareceu).
--   rebooking rate = clientes com ≥2 concluídos no período ÷ clientes com ≥1 concluído.
--   utilização = minutos ocupados (tudo exceto 'cancelado') ÷ minutos da grade
--     (working_hours, descontando break) por profissional/dia no período.
--   ticket médio = sum(price_cents) ÷ count de concluídos (price snapshot do ato).
-- Filtros profissionais/serviço: UUID nullable; inexistente no tenant → zeros (PT404 não;
-- UI usa filtros de catálogo válido). Dinheiro em *_cents; tempo em timestamptz UTC.
-- Aditiva e idempotente (create or replace + revoke/grant). Nenhuma migration aplicada é editada.

-- ============================================================================
-- Helpers internos (sem grant: só as RPCs públicas chamam).
-- ============================================================================

create or replace function public.report__assert_admin_period(
  p_from timestamptz,
  p_to timestamptz
)
returns void
language plpgsql
as $$
begin
  if current_role_name() is distinct from 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_from is null or p_to is null
     or p_to <= p_from
     or (p_to - p_from) > interval '366 days' then
    raise exception 'INVALID_PERIOD' using errcode = 'PT400';
  end if;
end;
$$;

revoke all on function public.report__assert_admin_period(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.report__assert_admin_period(timestamptz, timestamptz)
  to authenticated;

-- Minutos disponíveis por profissional no período a partir da grade semanal.
-- Retorna linhas (professional_id, available_minutes); grade sem linha no dia = 0.
create or replace function public.report__available_minutes(
  v_tenant uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_professional_id uuid
)
returns table (professional_id uuid, available_minutes int)
language sql
stable
as $$
  with days as (
    select generate_series(date_trunc('day', p_from), date_trunc('day', p_to - interval '1 second'),
             interval '1 day')::timestamptz as day_start
  ),
  pros as (
    select p.id
      from public.professionals p
     where p.tenant_id = v_tenant
       and (p_professional_id is null or p.id = p_professional_id)
  )
  select pr.id as professional_id,
         coalesce(sum(
           greatest(0, extract(epoch from (w.end_time - w.start_time)) / 60)::int
           - coalesce(greatest(0, extract(epoch from (w.break_end - w.break_start)) / 60)::int, 0)
         ), 0)::int as available_minutes
    from pros pr
    join days d on true
    left join public.working_hours w
      on w.tenant_id = v_tenant
     and w.professional_id = pr.id
     and w.weekday = extract(dow from d.day_start)::smallint
   group by pr.id;
$$;

revoke all on function public.report__available_minutes(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.report__available_minutes(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

-- ============================================================================
-- 1. report_noshow_rate.
-- ============================================================================
create or replace function public.report_noshow_rate(
  p_from timestamptz,
  p_to timestamptz,
  p_professional_id uuid default null,
  p_service_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_noshow int;
  v_done int;
  v_confirmed int;
begin
  perform public.report__assert_admin_period(p_from, p_to);

  select count(*) filter (where a.status = 'nao_compareceu')::int,
         count(*) filter (where a.status = 'concluido')::int,
         count(*) filter (where a.status = 'confirmado')::int
    into v_noshow, v_done, v_confirmed
    from public.appointments a
   where a.tenant_id = v_tenant
     and a.starts_at >= p_from
     and a.starts_at < p_to
     and (p_professional_id is null or a.professional_id = p_professional_id)
     and (p_service_id is null or a.service_id = p_service_id);

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('professional_id', p_professional_id, 'service_id', p_service_id),
    'no_show_count', v_noshow,
    'completed_count', v_done,
    'confirmed_count', v_confirmed,
    'denominator', v_noshow + v_done + v_confirmed,
    'no_show_rate',
      case when (v_noshow + v_done + v_confirmed) = 0 then 0
           else round(v_noshow::numeric / (v_noshow + v_done + v_confirmed), 4) end
  );
end;
$$;

revoke all on function public.report_noshow_rate(timestamptz, timestamptz, uuid, uuid)
  from public, anon;
grant execute on function public.report_noshow_rate(timestamptz, timestamptz, uuid, uuid)
  to authenticated;

comment on function public.report_noshow_rate(timestamptz, timestamptz, uuid, uuid) is
  'ADR-09: no-show rate (nao_compareceu / (concluido+confirmado+nao_compareceu)). Admin only.';

-- ============================================================================
-- 2. report_rebooking_rate.
-- ============================================================================
create or replace function public.report_rebooking_rate(
  p_from timestamptz,
  p_to timestamptz,
  p_professional_id uuid default null,
  p_service_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_active int;
  v_repeat int;
begin
  perform public.report__assert_admin_period(p_from, p_to);

  with visits as (
    select a.customer_id, count(*)::int as n
      from public.appointments a
     where a.tenant_id = v_tenant
       and a.status = 'concluido'
       and a.starts_at >= p_from
       and a.starts_at < p_to
       and (p_professional_id is null or a.professional_id = p_professional_id)
       and (p_service_id is null or a.service_id = p_service_id)
     group by a.customer_id
  )
  select count(*)::int,
         count(*) filter (where v.n >= 2)::int
    into v_active, v_repeat
    from visits v;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('professional_id', p_professional_id, 'service_id', p_service_id),
    'active_customers', v_active,
    'repeat_customers', v_repeat,
    'rebooking_rate',
      case when v_active = 0 then 0 else round(v_repeat::numeric / v_active, 4) end
  );
end;
$$;

revoke all on function public.report_rebooking_rate(timestamptz, timestamptz, uuid, uuid)
  from public, anon;
grant execute on function public.report_rebooking_rate(timestamptz, timestamptz, uuid, uuid)
  to authenticated;

comment on function public.report_rebooking_rate(timestamptz, timestamptz, uuid, uuid) is
  'ADR-09: rebooking rate (clientes com >=2 concluidos / ativos). Admin only.';

-- ============================================================================
-- 3. report_utilization.
-- ============================================================================
create or replace function public.report_utilization(
  p_from timestamptz,
  p_to timestamptz,
  p_professional_id uuid default null,
  p_service_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_occupied int;
  v_available int;
  v_by_pro jsonb;
begin
  perform public.report__assert_admin_period(p_from, p_to);

  select coalesce(sum(extract(epoch from (a.ends_at - a.starts_at)) / 60)::int, 0)
    into v_occupied
    from public.appointments a
   where a.tenant_id = v_tenant
     and a.status <> 'cancelado'
     and a.starts_at >= p_from
     and a.starts_at < p_to
     and (p_professional_id is null or a.professional_id = p_professional_id)
     and (p_service_id is null or a.service_id = p_service_id);

  select coalesce(sum(m.available_minutes), 0)::int
    into v_available
    from public.report__available_minutes(v_tenant, p_from, p_to, p_professional_id) m;

  select coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.professional_id), '[]'::jsonb)
    into v_by_pro
    from (
      select m.professional_id,
             coalesce(o.occupied_minutes, 0) as occupied_minutes,
             m.available_minutes,
             case when m.available_minutes = 0 then 0
                  else round(coalesce(o.occupied_minutes, 0)::numeric / m.available_minutes, 4) end
               as utilization_rate
        from public.report__available_minutes(v_tenant, p_from, p_to, p_professional_id) m
        left join (
          select a.professional_id,
                 sum(extract(epoch from (a.ends_at - a.starts_at)) / 60)::int as occupied_minutes
            from public.appointments a
           where a.tenant_id = v_tenant
             and a.status <> 'cancelado'
             and a.starts_at >= p_from
             and a.starts_at < p_to
             and (p_service_id is null or a.service_id = p_service_id)
           group by a.professional_id
        ) o on o.professional_id = m.professional_id
    ) t;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('professional_id', p_professional_id, 'service_id', p_service_id),
    'occupied_minutes', v_occupied,
    'available_minutes', v_available,
    'utilization_rate',
      case when v_available = 0 then 0 else round(v_occupied::numeric / v_available, 4) end,
    'by_professional', v_by_pro
  );
end;
$$;

revoke all on function public.report_utilization(timestamptz, timestamptz, uuid, uuid)
  from public, anon;
grant execute on function public.report_utilization(timestamptz, timestamptz, uuid, uuid)
  to authenticated;

comment on function public.report_utilization(timestamptz, timestamptz, uuid, uuid) is
  'ADR-09: utilizacao (ocupado exceto cancelado / grade working_hours com break). Admin only.';

-- ============================================================================
-- 4. report_ticket_medio.
-- ============================================================================
create or replace function public.report_ticket_medio(
  p_from timestamptz,
  p_to timestamptz,
  p_professional_id uuid default null,
  p_service_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_count int;
  v_total int;
begin
  perform public.report__assert_admin_period(p_from, p_to);

  select count(*)::int, coalesce(sum(a.price_cents), 0)::int
    into v_count, v_total
    from public.appointments a
   where a.tenant_id = v_tenant
     and a.status = 'concluido'
     and a.starts_at >= p_from
     and a.starts_at < p_to
     and (p_professional_id is null or a.professional_id = p_professional_id)
     and (p_service_id is null or a.service_id = p_service_id);

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('professional_id', p_professional_id, 'service_id', p_service_id),
    'completed_count', v_count,
    'total_cents', v_total,
    'average_ticket_cents', case when v_count = 0 then 0 else (v_total / v_count)::int end
  );
end;
$$;

revoke all on function public.report_ticket_medio(timestamptz, timestamptz, uuid, uuid)
  from public, anon;
grant execute on function public.report_ticket_medio(timestamptz, timestamptz, uuid, uuid)
  to authenticated;

comment on function public.report_ticket_medio(timestamptz, timestamptz, uuid, uuid) is
  'ADR-09: ticket medio (sum price_cents / concluidos). Admin only.';

-- ============================================================================
-- 5. report_cohort_retention.
-- Coorte = mes-calendario da primeira visita CONCLUIDA; janela N = dias corridos
-- apos a primeira visita; retido = >=1 concluido em (primeira, primeira+N].
-- ============================================================================
create or replace function public.report_cohort_retention(
  p_cohort_month date,
  p_windows int[] default '{30,60,90}'::int[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_month_start timestamptz := date_trunc('month', p_cohort_month::timestamptz);
  v_month_end timestamptz := v_month_start + interval '1 month';
  v_size int;
  v_retained int;
  v_result jsonb;
  w int;
begin
  if current_role_name() is distinct from 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_cohort_month is null then
    raise exception 'INVALID_PERIOD' using errcode = 'PT400';
  end if;
  if p_windows is null or cardinality(p_windows) = 0 then
    raise exception 'INVALID_PERIOD' using errcode = 'PT400';
  end if;
  foreach w in array p_windows loop
    if w is null or w < 1 or w > 365 then
      raise exception 'INVALID_PERIOD' using errcode = 'PT400';
    end if;
  end loop;

  with firsts as (
    select a.customer_id, min(a.starts_at) as first_visit
      from public.appointments a
     where a.tenant_id = v_tenant
       and a.status = 'concluido'
     group by a.customer_id
  ),
  cohort as (
    select f.customer_id, f.first_visit
      from firsts f
     where f.first_visit >= v_month_start
       and f.first_visit < v_month_end
  )
  select count(*)::int into v_size from cohort;

  v_result := '[]'::jsonb;
  foreach w in array p_windows loop
    with firsts as (
      select a.customer_id, min(a.starts_at) as first_visit
        from public.appointments a
       where a.tenant_id = v_tenant
         and a.status = 'concluido'
       group by a.customer_id
    ),
    cohort as (
      select f.customer_id, f.first_visit
        from firsts f
       where f.first_visit >= v_month_start
         and f.first_visit < v_month_end
    )
    select count(*) filter (
             where exists (
               select 1 from public.appointments r
                where r.tenant_id = v_tenant
                  and r.status = 'concluido'
                  and r.customer_id = c.customer_id
                  and r.starts_at > c.first_visit
                  and r.starts_at <= c.first_visit + (w || ' days')::interval
             )
           )::int
      into v_retained
      from cohort c;

    v_result := v_result || jsonb_build_object(
      'window_days', w,
      'retained_customers', v_retained,
      'retention_rate',
        case when v_size = 0 then 0 else round(v_retained::numeric / v_size, 4) end
    );
  end loop;

  return jsonb_build_object(
    'cohort_month', to_char(v_month_start, 'YYYY-MM'),
    'cohort_size', v_size,
    'windows', v_result
  );
end;
$$;

revoke all on function public.report_cohort_retention(date, int[])
  from public, anon;
grant execute on function public.report_cohort_retention(date, int[])
  to authenticated;

comment on function public.report_cohort_retention(date, int[]) is
  'ADR-09: retencao por coorte (mes da 1a visita concluida; janelas 30/60/90d). Admin only.';

-- ============================================================================
-- 6. report_retention_summary (cards do hub: compoe as 5 RPCs).
-- ============================================================================
create or replace function public.report_retention_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_noshow jsonb := public.report_noshow_rate(p_from, p_to, null, null);
  v_rebook jsonb := public.report_rebooking_rate(p_from, p_to, null, null);
  v_util jsonb := public.report_utilization(p_from, p_to, null, null);
  v_ticket jsonb := public.report_ticket_medio(p_from, p_to, null, null);
begin
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'noshow', v_noshow,
    'rebooking', v_rebook,
    'utilization', v_util,
    'ticket', v_ticket
  );
end;
$$;

revoke all on function public.report_retention_summary(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.report_retention_summary(timestamptz, timestamptz)
  to authenticated;

comment on function public.report_retention_summary(timestamptz, timestamptz) is
  'ADR-09: agregado p/ cards do hub (no-show, rebooking, utilizacao, ticket). Admin only.';

-- ============================================================================
-- Indice de apoio: filtros por status+janela e cliente+janela nas RPCs.
-- ============================================================================
create index if not exists appointments_tenant_status_starts_idx
  on public.appointments (tenant_id, status, starts_at);
create index if not exists appointments_tenant_customer_starts_idx
  on public.appointments (tenant_id, customer_id, starts_at);
