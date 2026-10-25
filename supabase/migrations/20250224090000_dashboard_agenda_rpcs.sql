-- Migration: RPCs de agregação do dashboard operacional da agenda (ADR-01, Fatia 1 do dashboard)
-- A rota /app (DashboardPage) troca o placeholder por um painel operacional. Esta migration é a
-- FUNDAÇÃO da fatia: as primeiras RPCs do projeto CHAMADAS PELO CLIENTE autenticado, que agregam
-- números da agenda SEMPRE NO BANCO (nunca no cliente — puxar milhares de linhas de appointments
-- para somar em JS violaria a RNF01 e o teto do PostgREST; defeito proibido no PRD §1). As ADR-02,
-- 03 e 04 (hooks + UI + gráfico) dependem desta.
--
-- PADRÃO NOVO E OPOSTO ao das funções de cron (whatsapp_enqueue_lembrete_d1, 20250223095000):
-- aquelas são SECURITY DEFINER + REVOKE de authenticated porque só o cron (postgres) as invoca e
-- precisam de privilégio elevado para escrever. Estas são SECURITY INVOKER + GRANT a authenticated:
-- rodam sob o RLS do CHAMADOR e HERDAM as policies já existentes de appointments
-- (appointments_select_tenant: admin/receptionist veem o tenant inteiro, professional só a própria
-- agenda) e de customers (customers_select_same_tenant). Por construção:
--   F1 — isolamento multi-tenant: tenant_id vem do JWT via current_tenant_id(), NUNCA de parâmetro;
--        a RPC não reimplementa predicado de tenant, herda do RLS.
--   F2 — RBAC: um professional agrega APENAS sobre as linhas que o RLS deixa ele ver; forjar
--        p_professional_id de um colega não retorna linhas dele.
--   F6 — SECURITY DEFINER é PROIBIDO nesta fatia: rodaria elevado e furaria o RLS (cross-tenant).
-- GRANT EXECUTE TO authenticated + REVOKE ALL FROM anon, public: a função é chamada com anon key +
-- sessão do usuário; o RLS é a fronteira. Nenhum segredo (service role/Asaas/Evolution) aqui.
--
-- NENHUMA tabela nova, NENHUMA coluna nova, NENHUMA policy de tabela alterada. A fatia é 100%
-- leitura agregada sobre o schema existente. Idempotente no re-apply (create or replace function);
-- não edita migration já aplicada. Timestamp posterior ao último existente (20250223097000).
--
-- FUSO 100% NO CLIENTE (D7): a matemática de fuso vive só em src/lib/datetime.ts. Estas funções são
-- "burras" quanto a fuso — recebem instantes timestamptz UTC absolutos (bordas de período/semana já
-- derivadas no cliente a partir de tenants.timezone) e só comparam contra elas. NUNCA
-- date_trunc('week') cru nem aritmética de fuso em SQL. Janelas semiabertas [inicio, fim), coerentes
-- com tenantDayRangeUtc/tenantRangeUtc/weekRangeOf.
--
-- REGRAS DE DOMÍNIO FECHADAS (PRD §7 / analysis-data §4):
--   D3 — denominador "agendados do período" = starts_at em [p_start,p_end) E status <> 'cancelado'
--        (cancelado não é oportunidade de comparecimento nem no-show; inclui-lo mascararia o no-show).
--   D4 — eixo temporal dos KPIs de agendamento = starts_at; novos clientes usa customers.created_at.
--   D5 — taxas com denominador 0 => NULL (nullif), nunca divisão por zero/NaN; a UI exibe "—".
--   D6 — a overview devolve período atual E anterior; a UI formata a comparação.
-- Dinheiro não se aplica nesta fatia (sem *_cents). Tempo em timestamptz (UTC).

-- ============================================================================
-- dashboard_agenda_overview — métrica-herói (no-show) + KPIs de status/taxas + novos clientes,
-- para o período atual E o anterior, numa única request. Cobre RF-DASH-01/02/03/04/06 e a
-- comparação (D6). Devolve um único objeto jsonb (contrato validado por zod no cliente, ADR-02).
--
-- p_professional_id (opcional): quando não-nulo, filtra professional_id = p_professional_id. NÃO é
-- fronteira de segurança — o RLS já recorta o professional (F2); é conveniência de UI / defesa em
-- profundidade (um admin filtrar um profissional). Mesmo espírito do useAppointments.
-- ============================================================================
create or replace function public.dashboard_agenda_overview(
  p_start           timestamptz,
  p_end             timestamptz,
  p_prev_start      timestamptz,
  p_prev_end        timestamptz,
  p_professional_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with appt as (
    -- Uma passada sobre appointments, classificando cada linha no período atual (0) ou anterior (1)
    -- pelo eixo starts_at (D4). O RLS já confina a tenant + papel (F1/F2). O filtro opcional por
    -- profissional é conveniência de UI, não fronteira.
    select
      case
        when a.starts_at >= p_start and a.starts_at < p_end then 0
        when a.starts_at >= p_prev_start and a.starts_at < p_prev_end then 1
      end as bucket,
      a.status
    from public.appointments a
    where (p_professional_id is null or a.professional_id = p_professional_id)
      and (
        (a.starts_at >= p_start and a.starts_at < p_end)
        or (a.starts_at >= p_prev_start and a.starts_at < p_prev_end)
      )
  ),
  agg as (
    select
      bucket,
      -- contagens por status (os 6 estados da máquina).
      count(*) filter (where status = 'pendente')        as pendente,
      count(*) filter (where status = 'confirmado')      as confirmado,
      count(*) filter (where status = 'em_atendimento')  as em_atendimento,
      count(*) filter (where status = 'concluido')       as concluido,
      count(*) filter (where status = 'cancelado')       as cancelado,
      count(*) filter (where status = 'nao_compareceu')  as nao_compareceu,
      -- D3: "agendados do período" = tudo menos cancelado. Denominador do no-show e do comparecimento.
      count(*) filter (where status <> 'cancelado')      as total_agendados
    from appt
    where bucket is not null
    group by bucket
  ),
  cust as (
    -- Novos clientes por bucket pelo eixo created_at (D4, exceção). customers tem RLS próprio.
    select
      case
        when c.created_at >= p_start and c.created_at < p_end then 0
        when c.created_at >= p_prev_start and c.created_at < p_prev_end then 1
      end as bucket,
      count(*) as new_customers
    from public.customers c
    where (
        (c.created_at >= p_start and c.created_at < p_end)
        or (c.created_at >= p_prev_start and c.created_at < p_prev_end)
      )
    group by 1
  ),
  period as (
    -- Monta o objeto de um bucket (b = 0 atual, 1 anterior). left join: bucket sem linhas => zeros,
    -- taxas NULL (D5). Nenhuma divisão por zero.
    select
      b.bucket,
      jsonb_build_object(
        'total_agendados',   coalesce(g.total_agendados, 0),
        'por_status', jsonb_build_object(
          'pendente',        coalesce(g.pendente, 0),
          'confirmado',      coalesce(g.confirmado, 0),
          'em_atendimento',  coalesce(g.em_atendimento, 0),
          'concluido',       coalesce(g.concluido, 0),
          'cancelado',       coalesce(g.cancelado, 0),
          'nao_compareceu',  coalesce(g.nao_compareceu, 0)
        ),
        'nao_compareceu',    coalesce(g.nao_compareceu, 0),
        -- D5: denominador 0 => NULL via nullif; a UI exibe "—".
        'no_show_rate',
          coalesce(g.nao_compareceu, 0)::numeric
          / nullif(coalesce(g.total_agendados, 0), 0),
        'confirmation_rate',
          coalesce(g.confirmado, 0)::numeric
          / nullif(coalesce(g.pendente, 0) + coalesce(g.confirmado, 0), 0),
        'attendance_rate',
          coalesce(g.concluido, 0)::numeric
          / nullif(coalesce(g.total_agendados, 0), 0),
        'new_customers',     coalesce(cu.new_customers, 0)
      ) as obj
    from (values (0), (1)) as b(bucket)
    left join agg  g  on g.bucket  = b.bucket
    left join cust cu on cu.bucket = b.bucket
  )
  select jsonb_build_object(
    'current',  (select obj from period where bucket = 0),
    'previous', (select obj from period where bucket = 1)
  );
$$;

comment on function public.dashboard_agenda_overview(timestamptz, timestamptz, timestamptz, timestamptz, uuid) is
  'Dashboard operacional (ADR-01 Fatia 1): agrega no-show, contagens por status, taxas de '
  'confirmacao/comparecimento e novos clientes para o periodo [p_start,p_end) e o anterior '
  '[p_prev_start,p_prev_end), num unico jsonb {current, previous}. Eixo starts_at (novos clientes '
  'usa created_at). Agendados = status <> cancelado (D3). Taxas com denominador 0 => null (D5). '
  'SECURITY INVOKER: herda o RLS de appointments/customers (isolamento e RBAC por construcao). '
  'p_professional_id e conveniencia de UI, nao fronteira (o RLS ja recorta o professional).';

grant execute on function public.dashboard_agenda_overview(timestamptz, timestamptz, timestamptz, timestamptz, uuid) to authenticated;
revoke all on function public.dashboard_agenda_overview(timestamptz, timestamptz, timestamptz, timestamptz, uuid) from anon;
revoke all on function public.dashboard_agenda_overview(timestamptz, timestamptz, timestamptz, timestamptz, uuid) from public;

-- ============================================================================
-- dashboard_agenda_por_profissional — volume de agendamentos por profissional no período. Cobre
-- RF-DASH-05. Rótulo honesto é da UI ("Agendamentos por profissional", NUNCA "Ocupação %"):
-- ocupação real (preenchido ÷ capacidade da grade) é melhoria futura (D1), fora de escopo aqui.
-- Para um professional, o RLS devolve naturalmente só a própria linha (F2). Join a professionals
-- para o nome; o RLS de professionals (herdado) confina ao tenant.
-- ============================================================================
create or replace function public.dashboard_agenda_por_profissional(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (
  professional_id uuid,
  name            text,
  total           bigint
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    a.professional_id,
    p.name,
    count(*) as total
  from public.appointments a
  join public.professionals p on p.id = a.professional_id
  where a.starts_at >= p_start
    and a.starts_at <  p_end
  group by a.professional_id, p.name
  order by total desc, p.name asc;
$$;

comment on function public.dashboard_agenda_por_profissional(timestamptz, timestamptz) is
  'Dashboard operacional (ADR-01 Fatia 1): contagem de agendamentos por profissional em '
  '[p_start,p_end) (eixo starts_at), com o nome via join a professionals. Volume, NAO ocupacao '
  'real (D1 — melhoria futura). SECURITY INVOKER: herda o RLS; para um professional retorna so a '
  'propria linha. Sem financeiro.';

grant execute on function public.dashboard_agenda_por_profissional(timestamptz, timestamptz) to authenticated;
revoke all on function public.dashboard_agenda_por_profissional(timestamptz, timestamptz) from anon;
revoke all on function public.dashboard_agenda_por_profissional(timestamptz, timestamptz) from public;

-- ============================================================================
-- dashboard_agenda_tendencia_semanal — série da tendência (6-8 semanas). Cobre RF-DASH-07. O
-- CLIENTE calcula as bordas de cada semana com weekRangeOf/tenantRangeUtc (DST-safe, fuso do
-- tenant) e passa dois arrays paralelos de instantes UTC; o SQL só conta por bucket entre as
-- bordas recebidas. NUNCA date_trunc('week') do Postgres (D7). Os arrays devem ter o mesmo
-- comprimento e cada [week_start, week_end) é semiaberto. Devolve uma linha por semana, na ordem
-- dos arrays recebidos.
-- ============================================================================
create or replace function public.dashboard_agenda_tendencia_semanal(
  p_week_starts timestamptz[],
  p_week_ends   timestamptz[]
)
returns table (
  week_start     timestamptz,
  agendados      bigint,
  nao_compareceu bigint
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    w.week_start,
    -- agendados = status <> cancelado (D3), coerente com a overview.
    count(a.id) filter (where a.status <> 'cancelado')     as agendados,
    count(a.id) filter (where a.status = 'nao_compareceu') as nao_compareceu
  from unnest(p_week_starts, p_week_ends) with ordinality as w(week_start, week_end, ord)
  left join public.appointments a
    on a.starts_at >= w.week_start
   and a.starts_at <  w.week_end
  group by w.ord, w.week_start
  order by w.ord;
$$;

comment on function public.dashboard_agenda_tendencia_semanal(timestamptz[], timestamptz[]) is
  'Dashboard operacional (ADR-01 Fatia 1): tendencia semanal (agendados e no-show por semana) '
  'bucketizada por bordas [week_start, week_end) que o CLIENTE calculou no fuso do tenant '
  '(weekRangeOf/tenantRangeUtc). Nunca date_trunc(week) cru (D7). Arrays p_week_starts/p_week_ends '
  'paralelos; uma linha por semana na ordem recebida. SECURITY INVOKER: herda o RLS.';

grant execute on function public.dashboard_agenda_tendencia_semanal(timestamptz[], timestamptz[]) to authenticated;
revoke all on function public.dashboard_agenda_tendencia_semanal(timestamptz[], timestamptz[]) from anon;
revoke all on function public.dashboard_agenda_tendencia_semanal(timestamptz[], timestamptz[]) from public;
