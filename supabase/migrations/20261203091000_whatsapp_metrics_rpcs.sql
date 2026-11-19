-- Migration: ADR-11 Fase 4 (H) — RPCs de métricas WhatsApp (admin only).
-- Escopo: 3 RPCs de agregação sobre `messages` + `campaign_sends` + `appointments`
-- existentes; nenhuma tabela nova (leitura confinada por `tenant_id = current_tenant_id()`
-- em TODA query). Não toca UI (ADR-18 gera CSV/tabs client-side do JSON).
--
-- Contrato:
--   whatsapp_kpis(p_from, p_to) → jsonb
--   whatsapp_message_log(p_from, p_to, p_status=null, p_template=null, p_direction=null,
--     p_search=null, p_page=1, p_page_size=20) → jsonb {items,total,page,page_size}
--   whatsapp_ban_risk(p_from, p_to) → jsonb {failure_rate,blocked_count,level,thresholds,
--     recommendation}
--   security invoker, search_path = public, pg_temp, sem p_tenant_id (deriva do JWT).
--   Só `admin` (PT403); período obrigatório com p_to > p_from e janela ≤ 366 dias (PT400);
--   página ≥1 e page_size 1..100 (PT400).
--
-- Definições (KPIs unificam régua `messages` + campanhas `campaign_sends`):
--   enviadas   = outbound saida (enviado,entregue,lida,respondida)
--                + sends (sent,delivered,read,replied,converted), por created_at no período.
--   entregues  = messages (entregue,lida,respondida) + sends (delivered,read,replied,converted).
--   lidas      = messages (lida,respondida) + sends (read,replied,converted).
--   respostas  = messages direction=entrada (qualquer status) + messages respondida
--                + sends replied. (Inbound ainda não é persistido pelo webhook atual;
--                a definição já o cobre quando ADR-12+ passar a gravar.)
--   falhas     = messages falha + sends failed.
--   confirmadas= appointments confirmed_via='cliente_whatsapp' com confirmed_at no período
--                (Opção A do PRD — determinística, sem join frágil com messages).
--   rates      = delivery_rate entregues/enviadas; read_rate lidas/entregues;
--                failure_rate falhas/(enviadas+falhas). Denominador 0 → 0.
--
-- Ban risk (resposta à pergunta 10 do PRD):
--   limiares failure_rate: ok < 0.05, atencao 0.05–0.15, critico > 0.15;
--   qualquer bloqueio explícito (failure_reason ilike %bloque%|%blocked%|%ban%) → critico.
--   Retorna nível + recomendação; NUNCA bloqueia automaticamente (decisão humana).
--
-- RBAC: admin only nas 3 RPCs (RF-41). RLS de `messages` inalterada (log operacional segue
-- legível p/ staff); `campaign_sends` legível p/ admin+recepção — mas a RPC nega antes de ler.
-- LGPD: log retorna customer_id + customer_name (join p/ usabilidade), nunca telefone/documento;
-- search casa provider_message_id, failure_reason e nome (sem telefone em claro no log).
-- Aditiva e idempotente (create or replace + revoke/grant). Nenhuma migration aplicada é editada.

-- ============================================================================
-- Helper interno: gate admin + período (sem grant — só as RPCs públicas chamam).
-- ============================================================================
create or replace function public.whatsapp__assert_admin_period(
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

revoke all on function public.whatsapp__assert_admin_period(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.whatsapp__assert_admin_period(timestamptz, timestamptz)
  to authenticated;

-- ============================================================================
-- 1. whatsapp_kpis — RF-40 (KPIs por período).
-- ============================================================================
create or replace function public.whatsapp_kpis(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_enviadas int := 0;
  v_entregues int := 0;
  v_lidas int := 0;
  v_respostas int := 0;
  v_falhas int := 0;
  v_confirmadas int := 0;
begin
  perform public.whatsapp__assert_admin_period(p_from, p_to);

  -- Régua (messages): janela por created_at.
  select
    count(*) filter (
      where m.direction = 'saida'
        and m.status in ('enviado','entregue','lida','respondida'))::int,
    count(*) filter (
      where m.direction = 'saida'
        and m.status in ('entregue','lida','respondida'))::int,
    count(*) filter (
      where m.direction = 'saida'
        and m.status in ('lida','respondida'))::int,
    count(*) filter (
      where m.direction = 'entrada'
         or (m.direction = 'saida' and m.status = 'respondida'))::int,
    count(*) filter (where m.status = 'falha')::int
    into v_enviadas, v_entregues, v_lidas, v_respostas, v_falhas
    from public.messages m
   where m.tenant_id = v_tenant
     and m.created_at >= p_from
     and m.created_at < p_to;

  -- Campanhas (campaign_sends): soma ao mesmo funil.
  select
    v_enviadas + count(*) filter (
      where s.status in ('sent','delivered','read','replied','converted'))::int,
    v_entregues + count(*) filter (
      where s.status in ('delivered','read','replied','converted'))::int,
    v_lidas + count(*) filter (
      where s.status in ('read','replied','converted'))::int,
    v_respostas + count(*) filter (where s.status = 'replied')::int,
    v_falhas + count(*) filter (where s.status = 'failed')::int
    into v_enviadas, v_entregues, v_lidas, v_respostas, v_falhas
    from public.campaign_sends s
   where s.tenant_id = v_tenant
     and s.created_at >= p_from
     and s.created_at < p_to;

  -- Confirmadas via WhatsApp (Opção A do PRD): carimbo confirmed_at no período.
  select count(*)::int into v_confirmadas
    from public.appointments a
   where a.tenant_id = v_tenant
     and a.confirmed_via = 'cliente_whatsapp'
     and a.confirmed_at >= p_from
     and a.confirmed_at < p_to;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'enviadas', v_enviadas,
    'entregues', v_entregues,
    'lidas', v_lidas,
    'confirmadas', v_confirmadas,
    'respostas', v_respostas,
    'falhas', v_falhas,
    'delivery_rate',
      case when v_enviadas = 0 then 0
           else round(v_entregues::numeric / v_enviadas, 4) end,
    'read_rate',
      case when v_entregues = 0 then 0
           else round(v_lidas::numeric / v_entregues, 4) end,
    'failure_rate',
      case when (v_enviadas + v_falhas) = 0 then 0
           else round(v_falhas::numeric / (v_enviadas + v_falhas), 4) end
  );
end;
$$;

revoke all on function public.whatsapp_kpis(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.whatsapp_kpis(timestamptz, timestamptz)
  to authenticated;

comment on function public.whatsapp_kpis(timestamptz, timestamptz) is
  'ADR-11: KPIs WhatsApp (régua + campanhas + confirmadas via confirmed_via). Admin only.';

-- ============================================================================
-- 2. whatsapp_message_log — RF-40 (log filtrável, paginado). LGPD: sem telefone.
-- ============================================================================
create or replace function public.whatsapp_message_log(
  p_from timestamptz,
  p_to timestamptz,
  p_status text default null,
  p_template text default null,
  p_direction text default null,
  p_search text default null,
  p_page int default 1,
  p_page_size int default 20
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_page int := coalesce(p_page, 1);
  v_size int := coalesce(p_page_size, 20);
  v_total int := 0;
  v_items jsonb;
begin
  perform public.whatsapp__assert_admin_period(p_from, p_to);
  if v_page < 1 or v_size < 1 or v_size > 100 then
    raise exception 'INVALID_PAGE' using errcode = 'PT400';
  end if;
  if p_status is not null
     and p_status not in ('fila','enviando','enviado','entregue','lida','respondida','falha') then
    raise exception 'INVALID_STATUS' using errcode = 'PT400';
  end if;
  if p_direction is not null and p_direction not in ('saida','entrada') then
    raise exception 'INVALID_DIRECTION' using errcode = 'PT400';
  end if;

  select count(*)::int into v_total
    from public.messages m
    join public.customers c
      on c.tenant_id = m.tenant_id
     and c.id = m.customer_id
   where m.tenant_id = v_tenant
     and m.created_at >= p_from
     and m.created_at < p_to
     and (p_status is null or m.status = p_status)
     and (p_template is null or m.template = p_template)
     and (p_direction is null or m.direction = p_direction)
     and (p_search is null
          or m.provider_message_id ilike '%' || p_search || '%'
          or m.failure_reason ilike '%' || p_search || '%'
          or c.name ilike '%' || p_search || '%');

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
    into v_items
    from (
      select m.id, m.template, m.status, m.direction,
             m.provider_message_id, m.failure_reason,
             m.delivered_at, m.read_at, m.campaign_id,
             m.customer_id, c.name as customer_name,
             m.created_at
        from public.messages m
        join public.customers c
          on c.tenant_id = m.tenant_id
         and c.id = m.customer_id
       where m.tenant_id = v_tenant
         and m.created_at >= p_from
         and m.created_at < p_to
         and (p_status is null or m.status = p_status)
         and (p_template is null or m.template = p_template)
         and (p_direction is null or m.direction = p_direction)
         and (p_search is null
              or m.provider_message_id ilike '%' || p_search || '%'
              or m.failure_reason ilike '%' || p_search || '%'
              or c.name ilike '%' || p_search || '%')
       order by m.created_at desc
       limit v_size offset ((v_page - 1) * v_size)
    ) t;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object(
      'status', p_status, 'template', p_template,
      'direction', p_direction, 'search', p_search),
    'page', v_page,
    'page_size', v_size,
    'total', v_total,
    'items', v_items
  );
end;
$$;

revoke all on function public.whatsapp_message_log(timestamptz, timestamptz, text, text, text, text, int, int)
  from public, anon;
grant execute on function public.whatsapp_message_log(timestamptz, timestamptz, text, text, text, text, int, int)
  to authenticated;

comment on function public.whatsapp_message_log(timestamptz, timestamptz, text, text, text, text, int, int) is
  'ADR-11: log filtrável de messages (status/template/direção/busca, paginado, sem telefone). Admin only.';

-- ============================================================================
-- 3. whatsapp_ban_risk — RF-40 + pergunta 10 do PRD (alerta, nunca auto-bloqueio).
-- ============================================================================
create or replace function public.whatsapp_ban_risk(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_enviadas int := 0;
  v_falhas int := 0;
  v_blocked int := 0;
  v_rate numeric := 0;
  v_level text := 'ok';
  v_recommendation text;
begin
  perform public.whatsapp__assert_admin_period(p_from, p_to);

  select
    count(*) filter (
      where m.direction = 'saida'
        and m.status in ('enviado','entregue','lida','respondida'))::int,
    count(*) filter (where m.status = 'falha')::int,
    count(*) filter (
      where m.status = 'falha'
        and (m.failure_reason ilike '%bloque%'
             or m.failure_reason ilike '%blocked%'
             or m.failure_reason ilike '%ban%'))::int
    into v_enviadas, v_falhas, v_blocked
    from public.messages m
   where m.tenant_id = v_tenant
     and m.created_at >= p_from
     and m.created_at < p_to;

  select
    v_enviadas + count(*) filter (
      where s.status in ('sent','delivered','read','replied','converted'))::int,
    v_falhas + count(*) filter (where s.status = 'failed')::int
    into v_enviadas, v_falhas
    from public.campaign_sends s
   where s.tenant_id = v_tenant
     and s.created_at >= p_from
     and s.created_at < p_to;

  if (v_enviadas + v_falhas) > 0 then
    v_rate := round(v_falhas::numeric / (v_enviadas + v_falhas), 4);
  end if;

  -- Limiares (pergunta 10): warn 5%, crítico 15% ou qualquer bloqueio explícito.
  if v_blocked > 0 or v_rate > 0.15 then
    v_level := 'critico';
  elsif v_rate >= 0.05 then
    v_level := 'atencao';
  else
    v_level := 'ok';
  end if;

  v_recommendation := case v_level
    when 'critico' then 'Pausar campanhas, revisar opt-in e qualidade dos templates antes de retomar. Nenhum bloqueio automático foi aplicado.'
    when 'atencao' then 'Monitorar falhas e revisar opt-in/lista de contatos; reduzir ritmo de campanhas se a taxa subir.'
    else 'Canal saudável. Manter opt-in e janela de envio.'
  end;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'enviadas', v_enviadas,
    'falhas', v_falhas,
    'blocked_count', v_blocked,
    'failure_rate', v_rate,
    'level', v_level,
    'thresholds', jsonb_build_object('warn', 0.05, 'critical', 0.15),
    'recommendation', v_recommendation
  );
end;
$$;

revoke all on function public.whatsapp_ban_risk(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.whatsapp_ban_risk(timestamptz, timestamptz)
  to authenticated;

comment on function public.whatsapp_ban_risk(timestamptz, timestamptz) is
  'ADR-11: risco de ban (failure_rate + bloqueios explícitos; alerta, nunca auto-bloqueio). Admin only.';
