-- Migration: ADR-07 — contas a receber avulsas (receivables + settlements + cobrança PIX).
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Escopo (ADR-07, RF-18..21 + PRD §6.4/§7): cobrança avulsa fora do ledger, com
-- categoria própria no DRE; recebimento total/parcial com auditoria; cobrança PIX
-- idempotente por conta (Edge `create-receivable-charge`) e liquidação por webhook.
--
-- Fronteira inegociável: `appointment_payments` é a SSoT de receita de serviço.
-- Nada nesta migration escreve no ledger; avulsa paga NUNCA migra para ele.
--
-- Decisões (ADR-07 + PRD §10.9 delegada):
--   - Status `pendente|parcial|pago|cancelado` (ADR-07 §Decisão). "Vencida" é
--     estado DERIVADO na leitura (`pendente` e `vencimento_at < now()`), nunca
--     coluna: evita cron e mantém o histórico coerente sem UPDATE em massa.
--   - `categoria` livre com default `'avulsa'`: o DRE (ADR-09) agrupa as avulsas
--     em categoria própria, separada da receita do ledger.
--   - Resto de recebimento parcial = saldo na MESMA conta
--     (`resto = valor_cents - sum(settlements)`), sem nova cobrança automática.
--   - `receivable_settlements` é append-only (trigger barra update/delete,
--     inclusive service_role): correção é linha nova, nunca edição.
--   - Replay de webhook não duplica: unique parcial `(tenant_id, event_id)` +
--     guarda de idempotência dentro de `receivable_settle_webhook`.
--   - Escrita direta pelo cliente: nenhuma (sem policy de write); mutações só via
--     RPCs SECURITY DEFINER com gate interno admin, ou via service_role.
--
-- Convenções: inglês/snake_case/plural; *_cents; timestamptz UTC; FK composta por
-- tenant; security definer + search_path fixo; erros de domínio PT4xx.

-- ============================================================================
-- 1) receivables — cobrança avulsa do cliente (fora do ledger de atendimento).
-- ============================================================================
create table if not exists public.receivables (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default current_tenant_id()
                     references public.tenants (id) on delete cascade,
  customer_id      uuid not null,
  descricao        text not null check (char_length(descricao) between 1 and 200),
  categoria        text not null default 'avulsa'
                     check (char_length(categoria) between 1 and 60),
  vencimento_at    timestamptz not null,
  valor_cents      int not null check (valor_cents > 0),
  status           text not null default 'pendente'
                     check (status in ('pendente','parcial','pago','cancelado')),
  asaas_payment_id text,
  pix_qr_code      text,
  pix_copy_paste   text,
  charge_expires_at timestamptz,
  created_at       timestamptz not null default now(),
  constraint receivables_tenant_id_unique unique (tenant_id, id),
  constraint receivables_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict
);

-- Uma cobrança do gateway por conta, por tenant (idempotência da cobrança).
create unique index if not exists receivables_tenant_asaas_payment_uidx
  on public.receivables (tenant_id, asaas_payment_id)
  where asaas_payment_id is not null;

create index if not exists receivables_tenant_status_idx
  on public.receivables (tenant_id, status, vencimento_at);
create index if not exists receivables_tenant_vencimento_idx
  on public.receivables (tenant_id, vencimento_at);
create index if not exists receivables_tenant_customer_idx
  on public.receivables (tenant_id, customer_id);

alter table public.receivables enable row level security;

-- Leitura: só admin do tenant (Financeiro admin-only, PRD §4).
drop policy if exists receivables_select_tenant_admin on public.receivables;
create policy receivables_select_tenant_admin on public.receivables
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.receivables from anon, authenticated;
grant select on table public.receivables to authenticated;
grant all on table public.receivables to service_role;
revoke truncate on table public.receivables from anon, authenticated;

-- ============================================================================
-- 2) receivable_settlements — recebimento total/parcial (append-only).
-- ============================================================================
create table if not exists public.receivable_settlements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default current_tenant_id()
                   references public.tenants (id) on delete cascade,
  receivable_id uuid not null,
  valor_cents   int not null check (valor_cents > 0),
  recebido_at   timestamptz not null default now(),
  metodo        text not null default 'pix'
                   check (metodo in ('dinheiro','pix','cartao_credito','cartao_debito','transferencia')),
  -- id do evento do gateway quando a linha nasceu de webhook (null no manual).
  event_id      text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint receivable_settlements_tenant_id_unique unique (tenant_id, id),
  constraint receivable_settlements_receivable_fk
    foreign key (tenant_id, receivable_id)
    references public.receivables (tenant_id, id) on delete restrict,
  constraint receivable_settlements_created_by_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id) on delete restrict
);

-- Trava REAL do replay de webhook: um evento liquida no máximo uma linha.
create unique index if not exists receivable_settlements_tenant_event_uidx
  on public.receivable_settlements (tenant_id, event_id)
  where event_id is not null;

create index if not exists receivable_settlements_tenant_receivable_idx
  on public.receivable_settlements (tenant_id, receivable_id, created_at);

alter table public.receivable_settlements enable row level security;

drop policy if exists receivable_settlements_select_tenant_admin on public.receivable_settlements;
create policy receivable_settlements_select_tenant_admin on public.receivable_settlements
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.receivable_settlements from anon, authenticated;
grant select on table public.receivable_settlements to authenticated;
grant all on table public.receivable_settlements to service_role;
revoke truncate on table public.receivable_settlements from anon, authenticated;

-- Append-only: update/delete barrados para qualquer role, inclusive service_role.
create or replace function public.receivable_settlements_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'receivable_settlements é append-only: update/delete proibidos (use linha nova)';
end;
$$;

drop trigger if exists receivable_settlements_no_update_delete on public.receivable_settlements;
create trigger receivable_settlements_no_update_delete
  before update or delete on public.receivable_settlements
  for each row execute function public.receivable_settlements_immutable();

-- ============================================================================
-- 3) RPCs de escrita (admin-only, SECURITY DEFINER).
-- ============================================================================

-- 3a) receivable_create — cria a cobrança avulsa pendente (RF-19).
create or replace function public.receivable_create(
  p_customer_id uuid,
  p_descricao text,
  p_valor_cents int,
  p_vencimento_at timestamptz,
  p_categoria text default 'avulsa'
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
  if p_customer_id is null
     or p_descricao is null or char_length(btrim(p_descricao)) not between 1 and 200
     or p_valor_cents is null or p_valor_cents <= 0
     or p_vencimento_at is null
     or char_length(coalesce(nullif(btrim(coalesce(p_categoria, '')), ''), 'avulsa')) > 60 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
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
    (v_tenant, p_customer_id, btrim(p_descricao),
     coalesce(nullif(btrim(coalesce(p_categoria, '')), ''), 'avulsa'),
     p_vencimento_at, p_valor_cents)
  returning id into v_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'receivable_created', 'receivable', v_id,
    jsonb_build_object('valor_cents', p_valor_cents, 'vencimento_at', p_vencimento_at)
  );

  return jsonb_build_object('receivable_id', v_id, 'status', 'pendente');
end;
$$;

revoke all on function public.receivable_create(uuid, text, int, timestamptz, text) from public, anon;
grant execute on function public.receivable_create(uuid, text, int, timestamptz, text) to authenticated, service_role;

-- 3b) receivable_settle — recebimento manual total/parcial (RF-21).
create or replace function public.receivable_settle(
  p_receivable_id uuid,
  p_valor_cents int,
  p_recebido_at timestamptz default now(),
  p_metodo text default 'pix'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_rec    public.receivables%rowtype;
  v_somado int;
  v_novo   int;
  v_status text;
begin
  if p_receivable_id is null
     or p_valor_cents is null or p_valor_cents <= 0
     or coalesce(p_metodo, 'pix') not in ('dinheiro','pix','cartao_credito','cartao_debito','transferencia') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_rec from public.receivables r
   where r.tenant_id = v_tenant and r.id = p_receivable_id
   for update;
  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_rec.status = 'cancelado' then
    raise exception 'RECEIVABLE_CANCELLED' using errcode = 'PT409';
  end if;
  if v_rec.status = 'pago' then
    raise exception 'RECEIVABLE_ALREADY_PAID' using errcode = 'PT409';
  end if;

  select coalesce(sum(s.valor_cents), 0) into v_somado
    from public.receivable_settlements s
   where s.tenant_id = v_tenant and s.receivable_id = p_receivable_id;

  v_novo := v_somado + p_valor_cents;
  if v_novo > v_rec.valor_cents then
    raise exception 'RECEIVABLE_OVERPAY' using errcode = 'PT409';
  end if;

  v_status := case when v_novo = v_rec.valor_cents then 'pago' else 'parcial' end;

  insert into public.receivable_settlements
    (tenant_id, receivable_id, valor_cents, recebido_at, metodo, created_by)
  values
    (v_tenant, p_receivable_id, p_valor_cents, coalesce(p_recebido_at, now()),
     coalesce(p_metodo, 'pix'), auth.uid());

  update public.receivables set status = v_status
   where tenant_id = v_tenant and id = p_receivable_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'receivable_settled', 'receivable', p_receivable_id,
    jsonb_build_object(
      'valor_cents', p_valor_cents,
      'metodo', coalesce(p_metodo, 'pix'),
      'status', v_status,
      'resto_cents', v_rec.valor_cents - v_novo
    )
  );

  return jsonb_build_object(
    'receivable_id', p_receivable_id,
    'status', v_status,
    'resto_cents', v_rec.valor_cents - v_novo
  );
end;
$$;

revoke all on function public.receivable_settle(uuid, int, timestamptz, text) from public, anon;
grant execute on function public.receivable_settle(uuid, int, timestamptz, text) to authenticated, service_role;

-- 3c) receivable_cancel — cancela conta ainda sem recebimento (auditado).
create or replace function public.receivable_cancel(
  p_receivable_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_rec    public.receivables%rowtype;
  v_count  int;
begin
  if p_receivable_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_rec from public.receivables r
   where r.tenant_id = v_tenant and r.id = p_receivable_id
   for update;
  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_rec.status = 'pago' then
    raise exception 'RECEIVABLE_ALREADY_PAID' using errcode = 'PT409';
  end if;

  select count(*) into v_count from public.receivable_settlements s
   where s.tenant_id = v_tenant and s.receivable_id = p_receivable_id;
  if v_count > 0 then
    raise exception 'RECEIVABLE_HAS_SETTLEMENTS' using errcode = 'PT409';
  end if;

  update public.receivables set status = 'cancelado'
   where tenant_id = v_tenant and id = p_receivable_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'receivable_cancelled', 'receivable', p_receivable_id,
    jsonb_build_object('motivo', p_motivo)
  );

  return jsonb_build_object('receivable_id', p_receivable_id, 'status', 'cancelado');
end;
$$;

revoke all on function public.receivable_cancel(uuid, text) from public, anon;
grant execute on function public.receivable_cancel(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 4) Webhook (só service_role): liquida a conta pelo evento do gateway.
--    security invoker + grant só service_role, espelhando membership_settle_charge.
-- ============================================================================
create or replace function public.receivable_settle_webhook(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_paid_at timestamptz default null,
  p_event_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rec      public.receivables%rowtype;
  v_recebido int;
  v_resto    int;
begin
  if p_tenant_id is null or p_receivable_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_rec from public.receivables r
   where r.tenant_id = p_tenant_id and r.id = p_receivable_id
   for update;
  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Replay do MESMO evento: sem efeito (a unique parcial é a trava sob corrida).
  if p_event_id is not null and exists (
    select 1 from public.receivable_settlements s
     where s.tenant_id = p_tenant_id and s.event_id = p_event_id
  ) then
    return jsonb_build_object(
      'receivable_id', p_receivable_id, 'status', v_rec.status,
      'settled', false, 'replayed', true
    );
  end if;

  -- Conta já quitada: webhook atrasado não reabre nem duplica recebimento.
  if v_rec.status = 'pago' then
    return jsonb_build_object(
      'receivable_id', p_receivable_id, 'status', v_rec.status,
      'settled', false, 'replayed', true
    );
  end if;

  if v_rec.status = 'cancelado' then
    raise exception 'RECEIVABLE_CANCELLED' using errcode = 'PT409';
  end if;

  select coalesce(sum(s.valor_cents), 0) into v_recebido
    from public.receivable_settlements s
   where s.tenant_id = p_tenant_id and s.receivable_id = p_receivable_id;

  v_resto := v_rec.valor_cents - v_recebido;
  if v_resto <= 0 then
    update public.receivables set status = 'pago'
     where tenant_id = p_tenant_id and id = p_receivable_id;
    return jsonb_build_object(
      'receivable_id', p_receivable_id, 'status', 'pago',
      'settled', false, 'replayed', true
    );
  end if;

  insert into public.receivable_settlements
    (tenant_id, receivable_id, valor_cents, recebido_at, metodo, event_id)
  values
    (p_tenant_id, p_receivable_id, v_resto, coalesce(p_paid_at, now()), 'pix',
     nullif(btrim(coalesce(p_event_id, '')), ''));

  update public.receivables set status = 'pago'
   where tenant_id = p_tenant_id and id = p_receivable_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, null, 'receivable_settled_webhook', 'receivable', p_receivable_id,
    jsonb_build_object('valor_cents', v_resto, 'event_id', p_event_id)
  );

  return jsonb_build_object(
    'receivable_id', p_receivable_id, 'status', 'pago',
    'settled', true, 'replayed', false, 'valor_cents', v_resto
  );
end;
$$;

revoke all on function public.receivable_settle_webhook(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.receivable_settle_webhook(uuid, uuid, timestamptz, text) to service_role;

-- ============================================================================
-- 5) Leitura da aba Atendimentos (ledger readonly, SSoT).
--    security invoker: RLS de `appointment_payments` (admin) e das tabelas de
--    apoio vale integralmente; nada de tenant_id vindo do cliente.
-- ============================================================================
create or replace function public.receivable_ledger_list(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.received_at desc), '[]'::jsonb)
    from (
      select p.id,
             p.appointment_id,
             p.method,
             p.amount_cents,
             p.tip_cents,
             p.source,
             p.received_at,
             c.name  as customer_name,
             s.name  as service_name
        from public.appointment_payments p
        join public.appointments a
          on a.tenant_id = p.tenant_id and a.id = p.appointment_id
        left join public.customers c
          on c.tenant_id = a.tenant_id and c.id = a.customer_id
        left join public.services s
          on s.tenant_id = a.tenant_id and s.id = a.service_id
       where p.voided_at is null
         and p.received_at >= p_from
         and p.received_at < p_to
       order by p.received_at desc
       limit 200
    ) t;
$$;

revoke all on function public.receivable_ledger_list(timestamptz, timestamptz) from public, anon;
grant execute on function public.receivable_ledger_list(timestamptz, timestamptz) to authenticated, service_role;
