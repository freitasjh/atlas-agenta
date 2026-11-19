-- Migration: ADR-08 — conciliação bancária (contas + extratos + linhas + vínculos).
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Escopo (ADR-08, RF-22..26 + PRD §6.5/§7): importação OFX/CSV com saldos e hash
-- dedupe, estados pendente/conciliado/ignorado, match automático (valor exato +
-- janela de 2 dias), conciliação em lote, criação de lançamento a partir de órfã,
-- ignorar com motivo, undo de 5s e, depois disso, undo admin auditado.
--
-- Decisões (ADR-08 §Decisão + PRD §10.8 delegada):
--   - Tolerância do match: valor EXATO em centavos + |Δdata| ≤ 2 dias
--     (`reconciliation_suggest_matches`). Depois da janela o par não é sugerido.
--     O `limit 10` é precedido de `order by abs(vencimento - data)`: sem isso o
--     melhor candidato (Δ = 0) podia ser descartado e o lote linkava o alvo de
--     outro dia em silêncio.
--   - Alvo já quitado não é sugerido: `pago` fica de fora (a baixa já aconteceu;
--     conciliar de novo duplicaria o recebimento). `parcial` continua elegível —
--     o título segue aberto e `valor_cents` é o valor cheio do lançamento.
--   - Conta bancária por tenant: N contas suportadas, sem conta "default" implícita
--     — a UI escolhe a conta do extrato (uma quando só existe uma).
--   - LGPD: NUNCA guardar agência/conta completa. Só `conta_ultimos4` (4 dígitos).
--     O extrato (descrição/valor) não vai para log técnico — ver Edge
--     `import-statement` (whitelist de log).
--   - Replay não duplica: unique `(tenant_id, arquivo_hash)`; o mesmo arquivo
--     reenviado devolve o statement existente com `replayed = true` e 0 linhas novas.
--   - Escrita direta pelo cliente: nenhuma (sem policy de write); mutações só por
--     RPCs SECURITY DEFINER com gate interno admin, ou service_role (import).
--   - Entitlement `conciliacao`: toda RPC MUTANTE (conta, link, criar lançamento,
--     ignorar, undo, import) recusa com `FEATURE_DISABLED` (PT403) quando o plano
--     do tenant não tem a feature. A leitura não é barrada aqui (a RLS já é
--     admin-only); o gating de leitura é da UI (`usePlanEntitlements`).
--   - `manual` existe só para casos sem contraparte e SEMPRE exige motivo legível
--     (≥3 chars), gravado em `reconciliation_links.motivo` — o banco barra o
--     vínculo manual sem motivo.
--   - Lançamento criado a partir da órfã nasce QUITADO na MESMA transação: o
--     movimento do extrato já é o caixa, então o payable/receivable recebe a baixa
--     (`payable_settlements`/`receivable_settlements`) com data da linha e
--     status `pago`. Sem isso o lançamento nasceria vencido e o KPI de "em aberto"
--     mentiria; a baixa não duplica receita/caixa porque o extrato não entra em
--     nenhum ledger financeiro.
--   - Vínculo: `bank_line_id` é único (uma linha concilia uma vez) e o ALVO também
--     (um lançamento não é conciliado por duas linhas) — índices únicos parciais.
--   - Undo: até 5s após o link basta a ação admin; depois disso a RPC exige motivo
--     (`UNDO_REASON_REQUIRED`). Toda remoção de vínculo gera evento em `audit_log`;
--     o vínculo apagado não é recriado — a linha volta a `pendente`.
--   - `appointment_payments` (ledger SSoT) NÃO é tocado por nada desta migration.
--
-- Convenções: inglês/snake_case/plural; *_cents; timestamptz UTC; FK composta por
-- tenant; security definer + search_path fixo; erros de domínio PT4xx com
-- message = código estável.

-- ============================================================================
-- 1) bank_accounts — conta bancária do tenant (sem agência/conta completa).
-- ============================================================================
create table if not exists public.bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default current_tenant_id()
                        references public.tenants (id) on delete cascade,
  nome                text not null check (char_length(btrim(nome)) between 1 and 120),
  banco               text not null check (char_length(btrim(banco)) between 1 and 60),
  -- LGPD: somente os 4 últimos dígitos; agência/conta completa nunca é persistida.
  conta_ultimos4      text not null check (conta_ultimos4 ~ '^[0-9]{4}$'),
  saldo_inicial_cents int not null default 0,
  ativo               bool not null default true,
  created_at          timestamptz not null default now(),
  constraint bank_accounts_tenant_id_unique unique (tenant_id, id)
);

-- Identifica a conta sem PII: mesmo banco + últimos 4 = mesma conta do tenant.
create unique index if not exists bank_accounts_tenant_ident_uidx
  on public.bank_accounts (tenant_id, banco, conta_ultimos4);

create index if not exists bank_accounts_tenant_nome_idx
  on public.bank_accounts (tenant_id, nome);

alter table public.bank_accounts enable row level security;

drop policy if exists bank_accounts_select_tenant_admin on public.bank_accounts;
create policy bank_accounts_select_tenant_admin on public.bank_accounts
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.bank_accounts from anon, authenticated;
grant select on table public.bank_accounts to authenticated;
grant all on table public.bank_accounts to service_role;
revoke truncate on table public.bank_accounts from anon, authenticated;

-- ============================================================================
-- 2) bank_statements — extrato importado (período, saldos, hash do arquivo).
-- ============================================================================
create table if not exists public.bank_statements (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default current_tenant_id()
                     references public.tenants (id) on delete cascade,
  account_id       uuid not null,
  formato          text not null check (formato in ('ofx','csv')),
  nome_arquivo     text not null check (char_length(btrim(nome_arquivo)) between 1 and 200),
  arquivo_hash     text not null check (arquivo_hash ~ '^[a-f0-9]{64}$'),
  periodo_ini      date not null,
  periodo_fim      date not null,
  saldo_ini_cents  int,
  saldo_fim_cents  int,
  linhas_total     int not null default 0 check (linhas_total >= 0),
  importado_por    uuid,
  created_at       timestamptz not null default now(),
  constraint bank_statements_tenant_id_unique unique (tenant_id, id),
  constraint bank_statements_periodo_check check (periodo_fim >= periodo_ini),
  constraint bank_statements_account_fk
    foreign key (tenant_id, account_id)
    references public.bank_accounts (tenant_id, id) on delete cascade,
  constraint bank_statements_importado_por_fk
    foreign key (tenant_id, importado_por)
    references public.profiles (tenant_id, id) on delete restrict
);

-- RF-22: replay do MESMO arquivo não cria um segundo extrato.
create unique index if not exists bank_statements_tenant_hash_uidx
  on public.bank_statements (tenant_id, arquivo_hash);

create index if not exists bank_statements_tenant_account_idx
  on public.bank_statements (tenant_id, account_id, periodo_fim desc);

alter table public.bank_statements enable row level security;

drop policy if exists bank_statements_select_tenant_admin on public.bank_statements;
create policy bank_statements_select_tenant_admin on public.bank_statements
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.bank_statements from anon, authenticated;
grant select on table public.bank_statements to authenticated;
grant all on table public.bank_statements to service_role;
revoke truncate on table public.bank_statements from anon, authenticated;

-- ============================================================================
-- 3) bank_lines — linha do extrato (valor assinado: negativo = saída).
-- ============================================================================
create table if not exists public.bank_lines (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id()
                    references public.tenants (id) on delete cascade,
  statement_id    uuid not null,
  data            date not null,
  descricao       text not null check (char_length(btrim(descricao)) between 1 and 255),
  -- Assinado: crédito > 0, débito < 0. Zero não existe em extrato bancário.
  valor_cents     int not null check (valor_cents <> 0),
  status          text not null default 'pendente'
                    check (status in ('pendente','conciliado','ignorado')),
  motivo_ignorado text,
  created_at      timestamptz not null default now(),
  constraint bank_lines_tenant_id_unique unique (tenant_id, id),
  constraint bank_lines_statement_fk
    foreign key (tenant_id, statement_id)
    references public.bank_statements (tenant_id, id) on delete cascade,
  -- RF-24: ignorar SEMPRE exige motivo legível (trava no banco, não só na UI).
  constraint bank_lines_ignorado_motivo_check
    check (status <> 'ignorado' or char_length(btrim(coalesce(motivo_ignorado, ''))) between 3 and 200)
);

create index if not exists bank_lines_tenant_statement_idx
  on public.bank_lines (tenant_id, statement_id, data);
create index if not exists bank_lines_tenant_status_idx
  on public.bank_lines (tenant_id, status, data);

alter table public.bank_lines enable row level security;

drop policy if exists bank_lines_select_tenant_admin on public.bank_lines;
create policy bank_lines_select_tenant_admin on public.bank_lines
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.bank_lines from anon, authenticated;
grant select on table public.bank_lines to authenticated;
grant all on table public.bank_lines to service_role;
revoke truncate on table public.bank_lines from anon, authenticated;

-- ============================================================================
-- 4) reconciliation_links — vínculo linha ↔ lançamento (auditável).
-- ============================================================================
create table if not exists public.reconciliation_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default current_tenant_id()
                 references public.tenants (id) on delete cascade,
  bank_line_id uuid not null,
  alvo_tipo   text not null check (alvo_tipo in ('payable','receivable','manual')),
  alvo_id     uuid,
  -- `match` = conciliação de lançamento existente (undo 5s); `entry` = nasceu junto
  -- com o lançamento criado a partir da órfã (undo proibido: orfanaria o lançamento).
  origem      text not null default 'match' check (origem in ('match','entry')),
  -- `manual` não tem alvo: o motivo é a contraparte legível (obrigatório).
  motivo      text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint reconciliation_links_tenant_id_unique unique (tenant_id, id),
  constraint reconciliation_links_alvo_check
    check (alvo_tipo = 'manual' or alvo_id is not null),
  -- RF-24 estendido: vínculo manual sem motivo é recusado pelo próprio banco.
  constraint reconciliation_links_manual_motivo_check
    check (
      alvo_tipo <> 'manual'
      or char_length(btrim(coalesce(motivo, ''))) between 3 and 200
    ),
  constraint reconciliation_links_bank_line_fk
    foreign key (tenant_id, bank_line_id)
    references public.bank_lines (tenant_id, id) on delete cascade,
  constraint reconciliation_links_created_by_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id) on delete restrict
);

-- Uma linha do extrato concilia uma única vez.
create unique index if not exists reconciliation_links_tenant_line_uidx
  on public.reconciliation_links (tenant_id, bank_line_id);
-- Um lançamento (payable/receivable) não é conciliado por duas linhas.
create unique index if not exists reconciliation_links_tenant_alvo_uidx
  on public.reconciliation_links (tenant_id, alvo_tipo, alvo_id)
  where alvo_id is not null;

create index if not exists reconciliation_links_tenant_created_idx
  on public.reconciliation_links (tenant_id, created_at desc);

alter table public.reconciliation_links enable row level security;

drop policy if exists reconciliation_links_select_tenant_admin on public.reconciliation_links;
create policy reconciliation_links_select_tenant_admin on public.reconciliation_links
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.reconciliation_links from anon, authenticated;
grant select on table public.reconciliation_links to authenticated;
grant all on table public.reconciliation_links to service_role;
revoke truncate on table public.reconciliation_links from anon, authenticated;

-- ============================================================================
-- 5) RPCs admin (SECURITY DEFINER) — conta, match, conciliar, criar, ignorar, undo.
-- ============================================================================

-- 5a) reconciliation_account_create — cria a conta (idempotente por banco+últimos4).
create or replace function public.reconciliation_account_create(
  p_nome text,
  p_banco text,
  p_conta_ultimos4 text,
  p_saldo_inicial_cents int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_id     uuid;
begin
  if p_nome is null or char_length(btrim(p_nome)) not between 1 and 120
     or p_banco is null or char_length(btrim(p_banco)) not between 1 and 60
     or p_conta_ultimos4 is null or p_conta_ultimos4 !~ '^[0-9]{4}$' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'conciliacao') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  insert into public.bank_accounts
    (tenant_id, nome, banco, conta_ultimos4, saldo_inicial_cents)
  values
    (v_tenant, btrim(p_nome), btrim(p_banco), p_conta_ultimos4,
     coalesce(p_saldo_inicial_cents, 0))
  on conflict (tenant_id, banco, conta_ultimos4) do nothing
  returning id into v_id;

  if v_id is null then
    select a.id into v_id from public.bank_accounts a
     where a.tenant_id = v_tenant
       and a.banco = btrim(p_banco)
       and a.conta_ultimos4 = p_conta_ultimos4;
    return jsonb_build_object('account_id', v_id, 'replayed', true);
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'reconciliation_account_created', 'bank_account', v_id,
    jsonb_build_object('banco', btrim(p_banco), 'conta_ultimos4', p_conta_ultimos4)
  );

  return jsonb_build_object('account_id', v_id, 'replayed', false);
end;
$$;

revoke all on function public.reconciliation_account_create(text, text, text, int) from public, anon;
grant execute on function public.reconciliation_account_create(text, text, text, int) to authenticated, service_role;

-- 5b) reconciliation_suggest_matches — candidatos do match (valor exato ±2 dias).
--     Crédito (valor > 0) casa receivables; débito (valor < 0) casa payables.
--     Alvos já vinculados e cancelados nunca são sugeridos.
create or replace function public.reconciliation_suggest_matches(
  p_bank_line_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_line   public.bank_lines%rowtype;
  v_abs    int;
  v_out    jsonb;
begin
  if p_bank_line_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_line from public.bank_lines l
   where l.tenant_id = v_tenant and l.id = p_bank_line_id;
  if not found then
    raise exception 'BANK_LINE_NOT_FOUND' using errcode = 'PT404';
  end if;

  v_abs := abs(v_line.valor_cents);

  if v_line.valor_cents < 0 then
    select coalesce(jsonb_agg(row_to_json(t) order by t.score desc, t.delta_dias, t.data), '[]'::jsonb)
      into v_out
      from (
        select 'payable'::text as alvo_tipo,
               p.id            as alvo_id,
               p.descricao     as descricao,
               p.valor_cents   as valor_cents,
               p.vencimento_at::date as data,
               abs(p.vencimento_at::date - v_line.data)::int as delta_dias,
               (100 - 10 * abs(p.vencimento_at::date - v_line.data))::int as score
          from public.payables p
         where p.tenant_id = v_tenant
           -- `pago` fora: já liquidado; sugerir de novo duplicaria a baixa.
           and p.status in ('pendente','parcial')
           and p.valor_cents = v_abs
           and abs(p.vencimento_at::date - v_line.data) <= 2
           and not exists (
             select 1 from public.reconciliation_links l
              where l.tenant_id = v_tenant
                and l.alvo_tipo = 'payable'
                and l.alvo_id = p.id
           )
         -- O `limit` só corta o candidato CERTO com esta ordenação (menor Δ primeiro).
         order by abs(p.vencimento_at::date - v_line.data), p.id
         limit 10
      ) t;
  else
    select coalesce(jsonb_agg(row_to_json(t) order by t.score desc, t.delta_dias, t.data), '[]'::jsonb)
      into v_out
      from (
        select 'receivable'::text as alvo_tipo,
               r.id            as alvo_id,
               r.descricao     as descricao,
               r.valor_cents   as valor_cents,
               r.vencimento_at::date as data,
               abs(r.vencimento_at::date - v_line.data)::int as delta_dias,
               (100 - 10 * abs(r.vencimento_at::date - v_line.data))::int as score
          from public.receivables r
         where r.tenant_id = v_tenant
           and r.status in ('pendente','parcial')
           and r.valor_cents = v_abs
           and abs(r.vencimento_at::date - v_line.data) <= 2
           and not exists (
             select 1 from public.reconciliation_links l
              where l.tenant_id = v_tenant
                and l.alvo_tipo = 'receivable'
                and l.alvo_id = r.id
           )
         order by abs(r.vencimento_at::date - v_line.data), r.id
         limit 10
      ) t;
  end if;

  return jsonb_build_object(
    'bank_line_id', v_line.id,
    'valor_cents', v_line.valor_cents,
    'data', v_line.data,
    'tolerancia_dias', 2,
    'candidatos', coalesce(v_out, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.reconciliation_suggest_matches(uuid) from public, anon;
grant execute on function public.reconciliation_suggest_matches(uuid) to authenticated, service_role;

-- 5c) reconciliation_link — concilia em lote (atômico: tudo ou nada).
--     Item: {"bank_line_id": uuid, "alvo_tipo": "payable|receivable|manual", "alvo_id": uuid|null}
create or replace function public.reconciliation_link(
  p_links jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_item   record;
  v_line   public.bank_lines%rowtype;
  v_alvo_valor int;
  v_link_id uuid;
  v_ids    jsonb := '[]'::jsonb;
  v_count  int := 0;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array'
     or jsonb_array_length(p_links) = 0
     or jsonb_array_length(p_links) > 200 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Forma validada ANTES do cast: UUID malformado nunca vira erro 500.
  if exists (
    select 1
      from jsonb_array_elements(p_links) e
     where jsonb_typeof(e) <> 'object'
        or (e->>'bank_line_id') is null
        or (e->>'bank_line_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(e->>'alvo_tipo', '') not in ('payable','receivable','manual')
        or ((e->>'alvo_tipo') <> 'manual' and (e->>'alvo_id') is null)
        or ((e->>'alvo_id') is not null
            and (e->>'alvo_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        -- `manual` sem contraparte só existe com motivo legível.
        or ((e->>'alvo_tipo') = 'manual'
            and char_length(btrim(coalesce(e->>'motivo', ''))) not between 3 and 200)
        or char_length(btrim(coalesce(e->>'motivo', ''))) > 200
  ) then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'conciliacao') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  for v_item in
    select (e->>'bank_line_id')::uuid  as bank_line_id,
           (e->>'alvo_tipo')           as alvo_tipo,
           nullif(e->>'alvo_id', '')::uuid as alvo_id,
           nullif(btrim(e->>'motivo'), '') as motivo
      from jsonb_array_elements(p_links) e
  loop
    if v_item.bank_line_id is null
       or coalesce(v_item.alvo_tipo, '') not in ('payable','receivable','manual')
       or (v_item.alvo_tipo <> 'manual' and v_item.alvo_id is null) then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    select * into v_line from public.bank_lines l
     where l.tenant_id = v_tenant and l.id = v_item.bank_line_id
     for update;
    if not found then
      raise exception 'BANK_LINE_NOT_FOUND' using errcode = 'PT404';
    end if;
    if v_line.status = 'conciliado' then
      raise exception 'RECONCILIATION_ALREADY_LINKED' using errcode = 'PT409';
    end if;
    if v_line.status = 'ignorado' then
      raise exception 'RECONCILIATION_LINE_IGNORED' using errcode = 'PT409';
    end if;

    -- Valor exato é a regra do match (ADR-08): só `manual` dispensa o alvo.
    if v_item.alvo_tipo = 'payable' then
      select p.valor_cents into v_alvo_valor from public.payables p
       where p.tenant_id = v_tenant and p.id = v_item.alvo_id and p.status <> 'cancelado';
      if not found then
        raise exception 'RECONCILIATION_TARGET_NOT_FOUND' using errcode = 'PT404';
      end if;
      if v_line.valor_cents <> -v_alvo_valor then
        raise exception 'RECONCILIATION_VALUE_MISMATCH' using errcode = 'PT409';
      end if;
    elsif v_item.alvo_tipo = 'receivable' then
      select r.valor_cents into v_alvo_valor from public.receivables r
       where r.tenant_id = v_tenant and r.id = v_item.alvo_id and r.status <> 'cancelado';
      if not found then
        raise exception 'RECONCILIATION_TARGET_NOT_FOUND' using errcode = 'PT404';
      end if;
      if v_line.valor_cents <> v_alvo_valor then
        raise exception 'RECONCILIATION_VALUE_MISMATCH' using errcode = 'PT409';
      end if;
    end if;

    begin
      insert into public.reconciliation_links
        (tenant_id, bank_line_id, alvo_tipo, alvo_id, motivo, created_by)
      values
        (v_tenant, v_item.bank_line_id, v_item.alvo_tipo, v_item.alvo_id, v_item.motivo, auth.uid())
      returning id into v_link_id;
    exception when unique_violation then
      if exists (
        select 1 from public.reconciliation_links l
         where l.tenant_id = v_tenant and l.bank_line_id = v_item.bank_line_id
      ) then
        raise exception 'RECONCILIATION_ALREADY_LINKED' using errcode = 'PT409';
      end if;
      raise exception 'RECONCILIATION_TARGET_ALREADY_LINKED' using errcode = 'PT409';
    end;

    update public.bank_lines
       set status = 'conciliado', motivo_ignorado = null
     where tenant_id = v_tenant and id = v_item.bank_line_id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      v_tenant, auth.uid(), 'reconciliation_linked', 'bank_line', v_item.bank_line_id,
      jsonb_build_object(
        'link_id', v_link_id,
        'alvo_tipo', v_item.alvo_tipo,
        'alvo_id', v_item.alvo_id,
        'motivo', v_item.motivo,
        'valor_cents', v_line.valor_cents
      )
    );

    v_ids := v_ids || to_jsonb(v_link_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('linked', v_count, 'link_ids', v_ids);
end;
$$;

revoke all on function public.reconciliation_link(jsonb) from public, anon;
grant execute on function public.reconciliation_link(jsonb) to authenticated, service_role;

-- 5d) reconciliation_create_entry — cria o lançamento a partir de linha órfã e concilia.
--     Débito (valor < 0) → conta a pagar; crédito (valor > 0) → conta a receber.
create or replace function public.reconciliation_create_entry(
  p_bank_line_id uuid,
  p_supplier_id uuid default null,
  p_customer_id uuid default null,
  p_categoria text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_line   public.bank_lines%rowtype;
  v_tipo   text;
  v_id     uuid;
  v_valor  int;
  v_desc   text;
  v_link   uuid;
begin
  if p_bank_line_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'conciliacao') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  select * into v_line from public.bank_lines l
   where l.tenant_id = v_tenant and l.id = p_bank_line_id
   for update;
  if not found then
    raise exception 'BANK_LINE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_line.status = 'conciliado' then
    raise exception 'RECONCILIATION_ALREADY_LINKED' using errcode = 'PT409';
  end if;
  if v_line.status = 'ignorado' then
    raise exception 'RECONCILIATION_LINE_IGNORED' using errcode = 'PT409';
  end if;

  v_valor := abs(v_line.valor_cents);
  v_desc  := left(btrim(v_line.descricao), 200);

  if v_line.valor_cents < 0 then
    v_tipo := 'payable';
    if p_supplier_id is not null and not exists (
      select 1 from public.suppliers s
       where s.tenant_id = v_tenant and s.id = p_supplier_id
    ) then
      raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'PT404';
    end if;

    insert into public.payables
      (tenant_id, supplier_id, descricao, categoria, vencimento_at, valor_cents)
    values
      (v_tenant, p_supplier_id, v_desc,
       nullif(btrim(coalesce(p_categoria, '')), ''),
       (v_line.data::timestamp at time zone 'UTC'), v_valor)
    returning id into v_id;

    -- O débito do extrato JÁ é o caixa: o lançamento nasce quitado (baixa na
    -- mesma transação), senão apareceria vencido no KPI e no DRE.
    insert into public.payable_settlements
      (tenant_id, payable_id, valor_cents, pago_at, conta, created_by)
    values
      (v_tenant, v_id, v_valor, (v_line.data::timestamp at time zone 'UTC'),
       'conciliacao', auth.uid());

    update public.payables set status = 'pago'
     where tenant_id = v_tenant and id = v_id;
  else
    v_tipo := 'receivable';
    if p_customer_id is null then
      raise exception 'CUSTOMER_REQUIRED' using errcode = 'PT400';
    end if;
    if not exists (
      select 1 from public.customers c
       where c.tenant_id = v_tenant and c.id = p_customer_id
    ) then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
    end if;

    insert into public.receivables
      (tenant_id, customer_id, descricao, categoria, vencimento_at, valor_cents)
    values
      (v_tenant, p_customer_id, v_desc,
       coalesce(nullif(btrim(coalesce(p_categoria, '')), ''), 'conciliacao'),
       (v_line.data::timestamp at time zone 'UTC'), v_valor)
    returning id into v_id;

    insert into public.receivable_settlements
      (tenant_id, receivable_id, valor_cents, recebido_at, metodo, created_by)
    values
      (v_tenant, v_id, v_valor, (v_line.data::timestamp at time zone 'UTC'),
       'transferencia', auth.uid());

    update public.receivables set status = 'pago'
     where tenant_id = v_tenant and id = v_id;
  end if;

  insert into public.reconciliation_links
    (tenant_id, bank_line_id, alvo_tipo, alvo_id, origem, created_by)
  values
    (v_tenant, p_bank_line_id, v_tipo, v_id, 'entry', auth.uid())
  returning id into v_link;

  update public.bank_lines
     set status = 'conciliado', motivo_ignorado = null
   where tenant_id = v_tenant and id = p_bank_line_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'reconciliation_entry_created', 'bank_line', p_bank_line_id,
    jsonb_build_object(
      'link_id', v_link,
      'alvo_tipo', v_tipo,
      'alvo_id', v_id,
      'valor_cents', v_line.valor_cents
    )
  );

  return jsonb_build_object(
    'bank_line_id', p_bank_line_id,
    'link_id', v_link,
    'alvo_tipo', v_tipo,
    'alvo_id', v_id,
    'status', 'conciliado'
  );
end;
$$;

revoke all on function public.reconciliation_create_entry(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.reconciliation_create_entry(uuid, uuid, uuid, text) to authenticated, service_role;

-- 5e) reconciliation_ignore — ignora em lote com motivo (RF-24).
create or replace function public.reconciliation_ignore(
  p_bank_line_ids uuid[],
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_id     uuid;
  v_status text;
  v_count  int := 0;
begin
  if p_bank_line_ids is null or cardinality(p_bank_line_ids) = 0
     or cardinality(p_bank_line_ids) > 200
     or p_motivo is null or char_length(btrim(p_motivo)) not between 3 and 200 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'conciliacao') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  foreach v_id in array p_bank_line_ids loop
    select l.status into v_status from public.bank_lines l
     where l.tenant_id = v_tenant and l.id = v_id
     for update;
    if not found then
      raise exception 'BANK_LINE_NOT_FOUND' using errcode = 'PT404';
    end if;
    if v_status = 'conciliado' then
      raise exception 'RECONCILIATION_LINE_RECONCILED' using errcode = 'PT409';
    end if;

    update public.bank_lines
       set status = 'ignorado', motivo_ignorado = btrim(p_motivo)
     where tenant_id = v_tenant and id = v_id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      v_tenant, auth.uid(), 'reconciliation_ignored', 'bank_line', v_id,
      jsonb_build_object('motivo', btrim(p_motivo))
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ignored', v_count);
end;
$$;

revoke all on function public.reconciliation_ignore(uuid[], text) from public, anon;
grant execute on function public.reconciliation_ignore(uuid[], text) to authenticated, service_role;

-- 5f) reconciliation_undo — desfaz o vínculo. Janela de 5s sem motivo; depois exige
--     motivo (admin auditado). O vínculo é apagado e a linha volta a `pendente`.
create or replace function public.reconciliation_undo(
  p_link_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_role     text;
  v_link     public.reconciliation_links%rowtype;
  v_dentro   boolean;
  v_motivo   text;
begin
  if p_link_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not public.tenant_has_feature(v_tenant, 'conciliacao') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  select * into v_link from public.reconciliation_links l
   where l.tenant_id = v_tenant and l.id = p_link_id
   for update;
  if not found then
    raise exception 'RECONCILIATION_LINK_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Vínculo criado JUNTO com o lançamento: desfazer orfanaria o lançamento.
  -- O caminho é cancelar o lançamento (auditado) e reimportar a linha.
  if v_link.origem = 'entry' then
    raise exception 'RECONCILIATION_ENTRY_UNDO_FORBIDDEN' using errcode = 'PT409';
  end if;

  v_dentro := (now() - v_link.created_at) <= interval '5 seconds';
  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');

  if not v_dentro and (v_motivo is null or char_length(v_motivo) < 3) then
    raise exception 'UNDO_REASON_REQUIRED' using errcode = 'PT400';
  end if;

  delete from public.reconciliation_links
   where tenant_id = v_tenant and id = p_link_id;

  update public.bank_lines
     set status = 'pendente', motivo_ignorado = null
   where tenant_id = v_tenant and id = v_link.bank_line_id
     and status = 'conciliado';

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(),
    case when v_dentro then 'reconciliation_undo' else 'reconciliation_undo_audited' end,
    'bank_line', v_link.bank_line_id,
    jsonb_build_object(
      'link_id', p_link_id,
      'alvo_tipo', v_link.alvo_tipo,
      'alvo_id', v_link.alvo_id,
      'dentro_da_janela', v_dentro,
      'motivo', v_motivo
    )
  );

  return jsonb_build_object(
    'bank_line_id', v_link.bank_line_id,
    'undone', true,
    'dentro_da_janela', v_dentro
  );
end;
$$;

revoke all on function public.reconciliation_undo(uuid, text) from public, anon;
grant execute on function public.reconciliation_undo(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 6) Import (só service_role): a Edge `import-statement` parseia o arquivo e
--    grava extrato + linhas de forma atômica. Hash dedupe devolve o existente.
-- ============================================================================
create or replace function public.reconciliation_statement_create(
  p_tenant_id uuid,
  p_account_id uuid,
  p_formato text,
  p_nome_arquivo text,
  p_arquivo_hash text,
  p_periodo_ini date,
  p_periodo_fim date,
  p_saldo_ini_cents int,
  p_saldo_fim_cents int,
  p_linhas jsonb,
  p_importado_por uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_stmt  public.bank_statements%rowtype;
  v_id    uuid;
  v_count int;
begin
  if p_tenant_id is null or p_account_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if p_formato is null or p_formato not in ('ofx','csv') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if p_nome_arquivo is null or char_length(btrim(p_nome_arquivo)) not between 1 and 200
     or p_arquivo_hash is null or p_arquivo_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if p_periodo_ini is null or p_periodo_fim is null or p_periodo_fim < p_periodo_ini then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if jsonb_array_length(p_linhas) not between 1 and 5000 then
    raise exception 'STATEMENT_EMPTY' using errcode = 'PT422';
  end if;

  -- Gate de entitlement também no caminho service_role (Edge): defesa em
  -- profundidade, independente do handler ter checado.
  if not public.tenant_has_feature(p_tenant_id, 'conciliacao') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  -- Valida TODAS as linhas antes de gravar (arquivo inválido ⇒ 0 linhas).
  if exists (
    select 1
      from jsonb_array_elements(p_linhas) e
     where jsonb_typeof(e) <> 'object'
        or (e->>'data') is null or (e->>'data') !~ '^\d{4}-\d{2}-\d{2}$'
        or (e->>'data')::date not between p_periodo_ini and p_periodo_fim
        or (e->>'descricao') is null
           or char_length(btrim(e->>'descricao')) not between 1 and 255
        or (e->>'valor_cents') is null or (e->>'valor_cents') !~ '^-?[0-9]{1,10}$'
        or (e->>'valor_cents')::bigint = 0
        or (e->>'valor_cents')::bigint > 2147483647
        or (e->>'valor_cents')::bigint < -2147483648
  ) then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if not exists (
    select 1 from public.bank_accounts a
     where a.tenant_id = p_tenant_id and a.id = p_account_id
  ) then
    raise exception 'BANK_ACCOUNT_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Replay: o mesmo arquivo (hash) não cria um segundo extrato nem linhas novas.
  select * into v_stmt from public.bank_statements s
   where s.tenant_id = p_tenant_id and s.arquivo_hash = p_arquivo_hash;
  if found then
    return jsonb_build_object(
      'statement_id', v_stmt.id,
      'linhas_total', v_stmt.linhas_total,
      'periodo_ini', v_stmt.periodo_ini,
      'periodo_fim', v_stmt.periodo_fim,
      'saldo_ini_cents', v_stmt.saldo_ini_cents,
      'saldo_fim_cents', v_stmt.saldo_fim_cents,
      'replayed', true
    );
  end if;

  insert into public.bank_statements
    (tenant_id, account_id, formato, nome_arquivo, arquivo_hash,
     periodo_ini, periodo_fim, saldo_ini_cents, saldo_fim_cents, importado_por)
  values
    (p_tenant_id, p_account_id, p_formato, btrim(p_nome_arquivo), p_arquivo_hash,
     p_periodo_ini, p_periodo_fim, p_saldo_ini_cents, p_saldo_fim_cents, p_importado_por)
  on conflict (tenant_id, arquivo_hash) do nothing
  returning id into v_id;

  -- Corrida entre duas importações do mesmo arquivo: o perdedor adota o vencedor.
  if v_id is null then
    select * into v_stmt from public.bank_statements s
     where s.tenant_id = p_tenant_id and s.arquivo_hash = p_arquivo_hash;
    return jsonb_build_object(
      'statement_id', v_stmt.id,
      'linhas_total', v_stmt.linhas_total,
      'periodo_ini', v_stmt.periodo_ini,
      'periodo_fim', v_stmt.periodo_fim,
      'saldo_ini_cents', v_stmt.saldo_ini_cents,
      'saldo_fim_cents', v_stmt.saldo_fim_cents,
      'replayed', true
    );
  end if;

  insert into public.bank_lines (tenant_id, statement_id, data, descricao, valor_cents)
  select p_tenant_id, v_id, (e->>'data')::date, btrim(e->>'descricao'), (e->>'valor_cents')::int
    from jsonb_array_elements(p_linhas) e;

  get diagnostics v_count = row_count;

  update public.bank_statements
     set linhas_total = v_count
   where tenant_id = p_tenant_id and id = v_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, p_importado_por, 'reconciliation_imported', 'bank_statement', v_id,
    jsonb_build_object(
      'formato', p_formato,
      'linhas_total', v_count,
      'periodo_ini', p_periodo_ini,
      'periodo_fim', p_periodo_fim
    )
  );

  return jsonb_build_object(
    'statement_id', v_id,
    'linhas_total', v_count,
    'periodo_ini', p_periodo_ini,
    'periodo_fim', p_periodo_fim,
    'saldo_ini_cents', p_saldo_ini_cents,
    'saldo_fim_cents', p_saldo_fim_cents,
    'replayed', false
  );
end;
$$;

revoke all on function public.reconciliation_statement_create(uuid, uuid, text, text, text, date, date, int, int, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.reconciliation_statement_create(uuid, uuid, text, text, text, date, date, int, int, jsonb, uuid) to service_role;

-- ============================================================================
-- 7) Índices de apoio ao match (tenant + valor + vencimento).
--    `reconciliation_suggest_matches` filtra por valor exato e janela de datas;
--    sem estes índices o match vira seq scan em payables/receivables.
-- ============================================================================
create index if not exists payables_tenant_valor_vencimento_idx
  on public.payables (tenant_id, valor_cents, vencimento_at);

create index if not exists receivables_tenant_valor_vencimento_idx
  on public.receivables (tenant_id, valor_cents, vencimento_at);
