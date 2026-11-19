-- Migration: ADR-09 — DRE (competência/caixa) + fluxo de caixa de 30 dias + export_logs.
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Escopo (ADR-09, RF-27..31 + PRD §6.6/§7): duas RPCs de agregação admin-only
-- (`dre_report`, `cashflow_30d`), a tabela `export_logs` (dono: este ADR; ADR-10
-- só consome) e a RPC de registro do export de DRE. Nenhuma tela nova de
-- export contábil aqui (ADR-10).
--
-- Decisões (ADR-09 §Decisão + PRD §10.9/§10.10 delegadas):
--   - Receita de atendimento = ledger `appointment_payments` (SSoT), sempre com
--     `voided_at is null` (estorno lógico fora). Regime `caixa` usa `received_at`;
--     regime `competencia` usa `appointments.starts_at` (data do atendimento).
--   - Receitas avulsas ficam em grupo PRÓPRIO ("Receitas avulsas"), nunca
--     misturadas com o ledger. `caixa` = `receivable_settlements.recebido_at`;
--     `competencia` = `receivables.valor_cents` de contas quitadas
--     (`status = 'pago'`) pelo `vencimento_at`. Avulsa paga nunca migra para o
--     ledger (decisão permanente do PRD §7).
--   - Recorrência membership = `membership_charges.status = 'pago'`, categoria
--     própria ("Recorrência"), sem duplo-contar o ledger (cobrança de membership
--     é gateway-only). `caixa` = `paid_at`; `competencia` = primeiro dia do mês
--     de `cycle_ref` (o ciclo que a cobrança remunera). PRD §10.10 respondida
--     assim: a data da recorrência na competência é o ciclo, não o pagamento.
--   - Custos = comissões apuradas (`appointment_commissions`), snapshot do
--     `concluido`. `caixa` = `calculated_at`; `competencia` = `starts_at` do
--     atendimento comissionado (a despesa acompanha a receita que a gerou).
--   - Despesas = `payables` pagos. `caixa` = `payable_settlements.pago_at`
--     (caixa real, inclui baixa parcial); `competencia` = `payables.valor_cents`
--     de contas quitadas pelo `vencimento_at`. Conta `parcial` não entra na
--     competência (só o caixa registra o que foi pago) — documentado.
--   - Gorjeta (`tip_cents`): FORA de receita, margem e resultado em TODOS os
--     regimes. Devolvida à parte em `gorjeta_ignorada_cents` só como
--     transparência auditável; nunca somada. (Gorjeta também já está fora da
--     base de comissão — regra de domínio.)
--   - Fronteira de período: as RPCs recebem instantes absolutos
--     (`p_ini`/`p_fim`) — o cliente deriva as bordas do fuso do TENANT
--     (`tenants.timezone`) com `tenantRangeUtc`, padrão do relatório de
--     comissão. O agrupamento mensal e o rótulo de dia são feitos no fuso do
--     tenant (`coalesce(timezone,'America/Sao_Paulo')`). Nada de `tenant_id`
--     trafegando do cliente: vem de `current_tenant_id()` (RLS/JWT).
--   - Série mensal (`meses`) é gerada contínua para todo mês tocado pelo
--     período, com zero nos meses sem movimento. A soma das barras é igual à
--     tabela por construção: as duas saem da MESMA CTE `mov`.
--   - `cashflow_30d`: janela de 30 dias começando em `p_base` (data de
--     calendário no fuso do tenant). Entradas = ledger + avulsas recebidas +
--     membership pago; saídas = baixas de `payables`. `saldo_acumulado_cents`
--     é a soma corrente DENTRO da janela; o último dia fecha com
--     `total_entradas - total_saidas`.
--   - `export_logs` é append-only de fato: só RPC admin cria; o cliente lê sob
--     RLS admin. `arquivo_path` guarda o nome do arquivo gerado no cliente
--     (ADR-09), obrigatório na RPC — log é prova de entrega; ADR-10 grava o
--     path real do storage.
--   - Gate de entitlement `dre_fluxo` em TODAS as RPCs (leitura e escrita):
--     plano sem a feature recebe `FEATURE_DISABLED` (PT403), nunca número.
--   - Nada aqui escreve em `appointment_payments` nem reinterpreta a receita
--     SSoT: as RPCs são somente leitura, exceto `export_log_create`, que só
--     grava log + auditoria.
--
-- Convenções: inglês/snake_case/plural; *_cents; timestamptz UTC; FK composta
-- por tenant; security definer + search_path fixo; erros de domínio PT4xx com
-- message = código estável.

-- ============================================================================
-- 1) export_logs — trilha de exportações (dono: ADR-09; ADR-10 consome).
-- ============================================================================
create table if not exists public.export_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default current_tenant_id()
                  references public.tenants (id) on delete cascade,
  -- `dre` / `fluxo` (ADR-09); ADR-10 acrescenta `ledger`/`ofx`/`sped` por Edge
  -- com service_role — por isso a coluna é text, não enum fechado.
  tipo          text not null check (char_length(btrim(tipo)) between 1 and 40),
  -- janela exportada em texto estável `YYYY-MM-DD..YYYY-MM-DD` (ou mês/base).
  periodo       text not null check (char_length(btrim(periodo)) between 1 and 80),
  formato       text not null check (formato in ('csv','ofx','sped')),
  -- nome/caminho do arquivo gerado. Null só para linhas fora deste ADR; a RPC
  -- `export_log_create` exige não vazio (export recusado nunca vira log).
  arquivo_path  text check (arquivo_path is null or char_length(arquivo_path) <= 300),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint export_logs_tenant_id_unique unique (tenant_id, id),
  constraint export_logs_created_by_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id) on delete restrict
);

create index if not exists export_logs_tenant_created_idx
  on public.export_logs (tenant_id, created_at desc);
create index if not exists export_logs_tenant_tipo_idx
  on public.export_logs (tenant_id, tipo, created_at desc);

alter table public.export_logs enable row level security;

-- Leitura: só admin do tenant (Financeiro admin-only, PRD §4).
drop policy if exists export_logs_select_tenant_admin on public.export_logs;
create policy export_logs_select_tenant_admin on public.export_logs
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.export_logs from anon, authenticated;
grant select on table public.export_logs to authenticated;
grant all on table public.export_logs to service_role;
revoke truncate on table public.export_logs from anon, authenticated;

-- ============================================================================
-- 2) Índices de apoio às agregações (tenant + eixo de data de cada fonte).
--    Sem eles, DRE/fluxo varrem a tabela inteira por tenant a cada abertura.
-- ============================================================================
create index if not exists appointment_commissions_tenant_calc_idx
  on public.appointment_commissions (tenant_id, calculated_at);

-- Eixo da competência: filtro por `(tenant_id, starts_at)` sem status. O índice
-- existente `appointments_tenant_status_starts_idx` exige `status` e não serve
-- para a janela pura.
create index if not exists appointments_tenant_starts_idx
  on public.appointments (tenant_id, starts_at);

create index if not exists payable_settlements_tenant_pago_idx
  on public.payable_settlements (tenant_id, pago_at);

create index if not exists receivable_settlements_tenant_recebido_idx
  on public.receivable_settlements (tenant_id, recebido_at);

create index if not exists membership_charges_tenant_paid_idx
  on public.membership_charges (tenant_id, paid_at)
  where status = 'pago';

-- ============================================================================
-- 3) dre_report — DRE por regime (competência ou caixa), com série mensal.
--    Receitas − Custos = Margem; Margem − Despesas = Resultado.
-- ============================================================================
create or replace function public.dre_report(
  p_ini timestamptz,
  p_fim timestamptz,
  p_regime text default 'caixa'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant      uuid;
  v_role        text;
  v_tz          text;
  v_regime      text;
  v_out         jsonb;
begin
  if p_ini is null or p_fim is null or p_fim <= p_ini then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  -- Guarda de custo: DRE de um ano e um pouco é o teto; acima disso a leitura
  -- vira varredura hostil. A UI pede 1 mês/6 meses; o contador, 1 ano.
  if p_fim - p_ini > interval '400 days' then
    raise exception 'RANGE_TOO_LARGE' using errcode = 'PT400';
  end if;

  v_regime := coalesce(nullif(btrim(p_regime), ''), 'caixa');
  if v_regime not in ('caixa','competencia') then
    raise exception 'INVALID_REGIME' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'dre_fluxo') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  select coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')
    into v_tz
    from public.tenants t
   where t.id = v_tenant;

  with mov as (
    -- Receita: ledger de atendimento (SSoT). Gorjeta fora.
    select
      case when v_regime = 'caixa'
           then to_char(p.received_at at time zone v_tz, 'YYYY-MM')
           else to_char(a.starts_at at time zone v_tz, 'YYYY-MM')
      end as mes,
      'receita'::text as tipo,
      'Atendimentos'::text as categoria,
      1::smallint as ordem,
      p.amount_cents as valor_cents
      from public.appointment_payments p
      join public.appointments a
        on a.tenant_id = p.tenant_id and a.id = p.appointment_id
     where p.tenant_id = v_tenant
       and p.voided_at is null
       and (
         (v_regime = 'caixa' and p.received_at >= p_ini and p.received_at < p_fim)
         or (v_regime = 'competencia' and a.starts_at >= p_ini and a.starts_at < p_fim)
       )

    union all

    -- Receita: avulsas recebidas (nunca no ledger), categoria própria.
    select
      to_char(s.recebido_at at time zone v_tz, 'YYYY-MM'),
      'receita'::text,
      'Receitas avulsas'::text,
      2::smallint,
      s.valor_cents
      from public.receivable_settlements s
     where s.tenant_id = v_tenant
       and v_regime = 'caixa'
       and s.recebido_at >= p_ini
       and s.recebido_at < p_fim

    union all

    select
      to_char(r.vencimento_at at time zone v_tz, 'YYYY-MM'),
      'receita'::text,
      'Receitas avulsas'::text,
      2::smallint,
      r.valor_cents
      from public.receivables r
     where r.tenant_id = v_tenant
       and v_regime = 'competencia'
       and r.status = 'pago'
       and r.vencimento_at >= p_ini
       and r.vencimento_at < p_fim

    union all

    -- Receita: recorrência (membership) — gateway-only, categoria própria.
    select
      to_char(c.paid_at at time zone v_tz, 'YYYY-MM'),
      'receita'::text,
      'Recorrência'::text,
      3::smallint,
      c.amount_cents
      from public.membership_charges c
     where c.tenant_id = v_tenant
       and c.status = 'pago'
       and c.paid_at is not null
       and v_regime = 'caixa'
       and c.paid_at >= p_ini
       and c.paid_at < p_fim

    union all

    select
      to_char(to_date(c.cycle_ref || '-01', 'YYYY-MM-DD'), 'YYYY-MM'),
      'receita'::text,
      'Recorrência'::text,
      3::smallint,
      c.amount_cents
      from public.membership_charges c
     where c.tenant_id = v_tenant
       and c.status = 'pago'
       and v_regime = 'competencia'
       -- Janela SEMIABERTA, igual às demais fontes: `p_fim` é o instante
       -- exclusivo (meia-noite local do dia seguinte ao último dia). Com
       -- `between` inclusivo o ciclo do mês seguinte entrava no total sem
       -- aparecer na série `meses` (total ≠ soma das barras).
       and to_date(c.cycle_ref || '-01', 'YYYY-MM-DD') >= (p_ini at time zone v_tz)::date
       and to_date(c.cycle_ref || '-01', 'YYYY-MM-DD') <  (p_fim at time zone v_tz)::date

    union all

    -- Custo: comissão apurada (snapshot do concluído).
    select
      case when v_regime = 'caixa'
           then to_char(ac.calculated_at at time zone v_tz, 'YYYY-MM')
           else to_char(a.starts_at at time zone v_tz, 'YYYY-MM')
      end,
      'custo'::text,
      'Comissões'::text,
      1::smallint,
      ac.commission_cents
      from public.appointment_commissions ac
      join public.appointments a
        on a.tenant_id = ac.tenant_id and a.id = ac.appointment_id
     where ac.tenant_id = v_tenant
       and (
         (v_regime = 'caixa' and ac.calculated_at >= p_ini and ac.calculated_at < p_fim)
         or (v_regime = 'competencia' and a.starts_at >= p_ini and a.starts_at < p_fim)
       )

    union all

    -- Despesa: baixas de contas a pagar (caixa real, inclui parcial).
    select
      to_char(s.pago_at at time zone v_tz, 'YYYY-MM'),
      'despesa'::text,
      coalesce(nullif(btrim(p.categoria), ''), 'Sem categoria'),
      9::smallint,
      s.valor_cents
      from public.payable_settlements s
      join public.payables p
        on p.tenant_id = s.tenant_id and p.id = s.payable_id
     where s.tenant_id = v_tenant
       and v_regime = 'caixa'
       and s.pago_at >= p_ini
       and s.pago_at < p_fim

    union all

    -- Despesa: contas quitadas reconhecidas na competência do vencimento.
    select
      to_char(p.vencimento_at at time zone v_tz, 'YYYY-MM'),
      'despesa'::text,
      coalesce(nullif(btrim(p.categoria), ''), 'Sem categoria'),
      9::smallint,
      p.valor_cents
      from public.payables p
     where p.tenant_id = v_tenant
       and v_regime = 'competencia'
       and p.status = 'pago'
       and p.vencimento_at >= p_ini
       and p.vencimento_at < p_fim
  ),
  series as (
    select to_char(d, 'YYYY-MM') as mes
      from generate_series(
             date_trunc('month', p_ini at time zone v_tz),
             date_trunc('month', (p_fim at time zone v_tz) - interval '1 second'),
             interval '1 month'
           ) d
  ),
  agregado as (
    select tipo, categoria, ordem, sum(valor_cents) as valor_cents
      from mov
     group by tipo, categoria, ordem
  ),
  por_mes as (
    select mes,
           coalesce(sum(valor_cents) filter (where tipo = 'receita'), 0)::int as receitas_cents,
           coalesce(sum(valor_cents) filter (where tipo = 'custo'), 0)::int as custos_cents,
           coalesce(sum(valor_cents) filter (where tipo = 'despesa'), 0)::int as despesas_cents
      from mov
     group by mes
  )
  select jsonb_build_object(
    'regime', v_regime,
    'ini', p_ini,
    'fim', p_fim,
    'receitas', jsonb_build_object(
      'total_cents', (
        select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'receita'
      ),
      'grupos', (
        select coalesce(
                 jsonb_agg(
                   jsonb_build_object('categoria', g.categoria, 'valor_cents', coalesce(ag.valor_cents, 0)::int)
                   order by g.ordem
                 ),
                 '[]'::jsonb
               )
          from (values ('Atendimentos', 1::smallint),
                       ('Receitas avulsas', 2::smallint),
                       ('Recorrência', 3::smallint)) as g(categoria, ordem)
          left join agregado ag
            on ag.tipo = 'receita' and ag.categoria = g.categoria
      )
    ),
    'custos', jsonb_build_object(
      'total_cents', (
        select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'custo'
      ),
      'grupos', (
        select coalesce(
                 jsonb_agg(
                   jsonb_build_object('categoria', categoria, 'valor_cents', valor_cents::int)
                   order by categoria
                 ),
                 '[]'::jsonb
               )
          from agregado
         where tipo = 'custo'
      )
    ),
    'margem_cents', (
      select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'receita'
    ) - (
      select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'custo'
    ),
    'despesas', jsonb_build_object(
      'total_cents', (
        select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'despesa'
      ),
      'grupos', (
        select coalesce(
                 jsonb_agg(
                   jsonb_build_object('categoria', categoria, 'valor_cents', valor_cents::int)
                   order by categoria
                 ),
                 '[]'::jsonb
               )
          from agregado
         where tipo = 'despesa'
      )
    ),
    'resultado_cents', (
      select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'receita'
    ) - (
      select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'custo'
    ) - (
      select coalesce(sum(valor_cents), 0)::int from mov where tipo = 'despesa'
    ),
    'gorjeta_ignorada_cents', coalesce((
      select sum(p.tip_cents)
        from public.appointment_payments p
        join public.appointments a
          on a.tenant_id = p.tenant_id and a.id = p.appointment_id
       where p.tenant_id = v_tenant
         and p.voided_at is null
         and (
           (v_regime = 'caixa' and p.received_at >= p_ini and p.received_at < p_fim)
           or (v_regime = 'competencia' and a.starts_at >= p_ini and a.starts_at < p_fim)
         )
    ), 0)::int,
    'meses', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'mes', s.mes,
                   'receitas_cents', coalesce(m.receitas_cents, 0),
                   'custos_cents', coalesce(m.custos_cents, 0),
                   'despesas_cents', coalesce(m.despesas_cents, 0),
                   'resultado_cents',
                     coalesce(m.receitas_cents, 0)
                     - coalesce(m.custos_cents, 0)
                     - coalesce(m.despesas_cents, 0)
                 )
                 order by s.mes
               ),
               '[]'::jsonb
             )
        from series s
        left join por_mes m on m.mes = s.mes
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.dre_report(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.dre_report(timestamptz, timestamptz, text) to authenticated, service_role;

-- ============================================================================
-- 4) cashflow_30d — entradas vs saídas por dia + saldo acumulado da janela.
-- ============================================================================
create or replace function public.cashflow_30d(
  p_base date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_role     text;
  v_tz       text;
  v_base     date;
  v_ini      timestamptz;
  v_fim      timestamptz;
  v_out      jsonb;
  v_entradas int;
  v_saidas   int;
begin
  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'dre_fluxo') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  select coalesce(nullif(t.timezone, ''), 'America/Sao_Paulo')
    into v_tz
    from public.tenants t
   where t.id = v_tenant;

  v_base := coalesce(p_base, (now() at time zone v_tz)::date);
  -- Meia-noite local do dia-base até meia-noite local do 31º dia (30 dias).
  v_ini := (v_base::timestamp at time zone v_tz);
  v_fim := ((v_base + 30)::timestamp at time zone v_tz);

  with entradas as (
    -- Ledger de atendimento (gorjeta fora: dinheiro de serviço, não de caixa operacional).
    select to_char(p.received_at at time zone v_tz, 'YYYY-MM-DD') as dia,
           sum(p.amount_cents)::int as valor_cents
      from public.appointment_payments p
     where p.tenant_id = v_tenant
       and p.voided_at is null
       and p.received_at >= v_ini
       and p.received_at < v_fim
     group by 1
    union all
    select to_char(s.recebido_at at time zone v_tz, 'YYYY-MM-DD'),
           sum(s.valor_cents)::int
      from public.receivable_settlements s
     where s.tenant_id = v_tenant
       and s.recebido_at >= v_ini
       and s.recebido_at < v_fim
     group by 1
    union all
    select to_char(c.paid_at at time zone v_tz, 'YYYY-MM-DD'),
           sum(c.amount_cents)::int
      from public.membership_charges c
     where c.tenant_id = v_tenant
       and c.status = 'pago'
       and c.paid_at is not null
       and c.paid_at >= v_ini
       and c.paid_at < v_fim
     group by 1
  ),
  entradas_dia as (
    select dia, sum(valor_cents)::int as valor_cents from entradas group by dia
  ),
  saidas as (
    select to_char(s.pago_at at time zone v_tz, 'YYYY-MM-DD') as dia,
           sum(s.valor_cents)::int as valor_cents
      from public.payable_settlements s
     where s.tenant_id = v_tenant
       and s.pago_at >= v_ini
       and s.pago_at < v_fim
     group by 1
  ),
  dias as (
    select to_char(d, 'YYYY-MM-DD') as dia
      from generate_series(v_base::timestamp, (v_base + 29)::timestamp, interval '1 day') d
  ),
  fluxo as (
    select d.dia,
           coalesce(e.valor_cents, 0) as entradas_cents,
           coalesce(s.valor_cents, 0) as saidas_cents,
           coalesce(e.valor_cents, 0) - coalesce(s.valor_cents, 0) as saldo_dia_cents
      from dias d
      left join entradas_dia e on e.dia = d.dia
      left join saidas s on s.dia = d.dia
  ),
  acumulado as (
    select dia,
           entradas_cents,
           saidas_cents,
           saldo_dia_cents,
           sum(saldo_dia_cents) over (order by dia)::int as saldo_acumulado_cents
      from fluxo
  )
  select
    coalesce(sum(entradas_cents), 0)::int,
    coalesce(sum(saidas_cents), 0)::int,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'dia', dia,
          'entradas_cents', entradas_cents,
          'saidas_cents', saidas_cents,
          'saldo_dia_cents', saldo_dia_cents,
          'saldo_acumulado_cents', saldo_acumulado_cents
        )
        order by dia
      ),
      '[]'::jsonb
    )
    into v_entradas, v_saidas, v_out
    from acumulado;

  return jsonb_build_object(
    'base', v_base,
    'dias', v_out,
    'total_entradas_cents', v_entradas,
    'total_saidas_cents', v_saidas,
    'saldo_final_cents', v_entradas - v_saidas
  );
end;
$$;

revoke all on function public.cashflow_30d(date) from public, anon;
grant execute on function public.cashflow_30d(date) to authenticated, service_role;

-- ============================================================================
-- 5) export_log_create — registra o export de DRE/fluxo (ADR-09).
--    Escopo deste ADR: `tipo` dre|fluxo, `formato` csv. ADR-10 usa service_role
--    para os demais formatos (não passa por esta RPC).
-- ============================================================================
create or replace function public.export_log_create(
  p_tipo text,
  p_periodo text,
  p_formato text default 'csv',
  p_arquivo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_tipo   text;
  v_form   text;
  v_per    text;
  v_id     uuid;
  v_created timestamptz;
begin
  v_tipo := lower(btrim(coalesce(p_tipo, '')));
  v_form := lower(btrim(coalesce(p_formato, '')));
  v_per  := btrim(coalesce(p_periodo, ''));

  -- `arquivo_path` é obrigatório: log sem arquivo é export recusado, e recusa
  -- não entra na trilha de auditoria como se tivesse gerado entrega.
  if v_tipo not in ('dre','fluxo')
     or v_form <> 'csv'
     or char_length(v_per) not between 1 and 80
     or char_length(btrim(coalesce(p_arquivo_path, ''))) not between 1 and 300 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'dre_fluxo') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  insert into public.export_logs (tenant_id, tipo, periodo, formato, arquivo_path, created_by)
  values (v_tenant, v_tipo, v_per, v_form, nullif(btrim(coalesce(p_arquivo_path, '')), ''), auth.uid())
  returning id, created_at into v_id, v_created;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'export_log_created', 'export_log', v_id,
    jsonb_build_object('tipo', v_tipo, 'periodo', v_per, 'formato', v_form)
  );

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

revoke all on function public.export_log_create(text, text, text, text) from public, anon;
grant execute on function public.export_log_create(text, text, text, text) to authenticated, service_role;
