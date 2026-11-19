-- Migration: fidelidade (ADR-06 Fase 4) — programa, contas, transações, expiração/estorno.
-- Escopo: tabelas `loyalty_programs` (1 por tenant), `loyalty_accounts` (saldo por
-- cliente), `loyalty_transactions` (append-only: credit/debit/expire/void) + RLS/RBAC +
-- RPCs idempotentes + triggers de conclusão/cancelamento. Gating por entitlement
-- `fidelidade` é server-side nas RPCs (`tenant_has_feature`, mesma decisão da ADR-05:
-- RLS não depende de entitlement; sem entitlement a rota some e a RPC nega com
-- FEATURE_DISABLED). Cupons/gift cards ficam para a ADR-07 (fora desta migration).
--
-- Regras (PRD §6.4 RF-17/RF-18/RF-22/RF-23):
--   - Crédito ocorre na CONCLUSÃO do atendimento (não no agendamento).
--   - `tip_cents` fora da base de pontos (análogo à comissão, RF-24); base =
--     `appointments.price_cents` (snapshot do ato do agendamento).
--   - Pontos expiram conforme `expiry_days` (null = sem expiração).
--   - Cancelamento estorna pontos creditados (estorno lógico, sem DELETE físico).
--   - Estorno de pagamento NÃO altera pontos (RF-24).
--   - `service_rules` jsonb: override por serviço
--     {"<service_uuid>": {"points_per_real": 2}}; sem entrada = taxa do programa.
--   - `levels` jsonb opcional (fora do MVP de cálculo; só config).
--
-- Recorte de entitlement (decisão): `fidelidade` em premium/enterprise — mesmo
-- recorte de campanhas/estoque/comissao_produto (PRD Q12 segue aberta; este é o
-- default seguro até definição comercial).
--
-- Concorrência: conta travada com FOR UPDATE; crédito idempotente por
-- (tenant, appointment, credit); expiração com SKIP LOCKED. RPCs SECURITY DEFINER
-- (precisam gravar contas/transações/audit_log, sem policy de escrita p/
-- authenticated) com tenant derivado da LINHA do appointment (não do JWT — o
-- trigger de conclusão roda no contexto do usuário que concluiu) + gate de papel
-- explícito (PT403). search_path fixo. Idempotente (if not exists / or replace /
-- drop policy if exists). Dinheiro em centavos; tempo em timestamptz (UTC).

-- ============================================================================
-- 1. loyalty_programs — 1 linha por tenant (pk = tenant_id).
-- ============================================================================
create table if not exists public.loyalty_programs (
  tenant_id       uuid primary key references public.tenants (id) on delete cascade,
  active          boolean not null default true,
  points_per_real numeric(10,2) not null default 1.00 check (points_per_real > 0),
  rounding        text not null default 'floor' check (rounding in ('floor','nearest')),
  expiry_days     int check (expiry_days is null or expiry_days > 0),
  service_rules   jsonb not null default '{}'::jsonb,
  levels          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.loyalty_programs enable row level security;

-- Leitura: todo papel operacional (admin/recepção/profissional — PDV precisa ler).
drop policy if exists loyalty_programs_select_staff on public.loyalty_programs;
create policy loyalty_programs_select_staff on public.loyalty_programs for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );

-- Escrita: só admin (config do dono). Sem DELETE físico pela app.
drop policy if exists loyalty_programs_write_admin on public.loyalty_programs;
create policy loyalty_programs_write_admin on public.loyalty_programs for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

create or replace function public.loyalty_programs_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
end;
$$;

drop trigger if exists loyalty_programs_no_hard_delete on public.loyalty_programs;
create trigger loyalty_programs_no_hard_delete
  before delete on public.loyalty_programs
  for each row execute function public.loyalty_programs_no_hard_delete();

-- ============================================================================
-- 2. loyalty_accounts — saldo de pontos por cliente.
-- ============================================================================
create table if not exists public.loyalty_accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  customer_id     uuid not null,
  balance_points  int not null default 0 check (balance_points >= 0),
  lifetime_points int not null default 0 check (lifetime_points >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint loyalty_accounts_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint loyalty_accounts_tenant_id_unique unique (tenant_id, id),
  constraint loyalty_accounts_customer_unique unique (tenant_id, customer_id)
);

create index if not exists loyalty_accounts_tenant_customer_idx
  on public.loyalty_accounts (tenant_id, customer_id);

alter table public.loyalty_accounts enable row level security;

-- Leitura: admin/recepção veem todos; profissional só clientes da própria agenda.
-- Sem policy de escrita: saldo só muda via RPCs SECURITY DEFINER (auditoria).
drop policy if exists loyalty_accounts_select_staff on public.loyalty_accounts;
create policy loyalty_accounts_select_staff on public.loyalty_accounts for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() in ('admin','receptionist')
      or (
        current_role_name() = 'professional'
        and exists (
          select 1 from public.appointments a
          join public.professionals p
            on p.tenant_id = a.tenant_id
           and p.id = a.professional_id
         where a.tenant_id = loyalty_accounts.tenant_id
           and a.customer_id = loyalty_accounts.customer_id
           and p.profile_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- 3. loyalty_transactions — ledger append-only de pontos.
-- ============================================================================
create table if not exists public.loyalty_transactions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default current_tenant_id()
    references public.tenants (id) on delete cascade,
  account_id     uuid not null,
  appointment_id uuid,
  type           text not null
    check (type in ('credit','debit','expire','void')),
  points         int not null check (points > 0),
  reason         text,
  expires_at     timestamptz,
  voided_at      timestamptz,
  voided_by      uuid,
  void_reason    text,
  created_at     timestamptz not null default now(),
  constraint loyalty_transactions_account_fk
    foreign key (tenant_id, account_id)
    references public.loyalty_accounts (tenant_id, id) on delete restrict,
  constraint loyalty_transactions_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint loyalty_transactions_tenant_id_unique unique (tenant_id, id)
);

-- Idempotência por atendimento+tipo: replay de conclusão/estorno não duplica.
create unique index if not exists loyalty_transactions_appointment_type_uidx
  on public.loyalty_transactions (tenant_id, appointment_id, type)
  where appointment_id is not null;

create index if not exists loyalty_transactions_account_created_idx
  on public.loyalty_transactions (tenant_id, account_id, created_at desc);
create index if not exists loyalty_transactions_expiry_idx
  on public.loyalty_transactions (tenant_id, expires_at)
  where type = 'credit' and voided_at is null;

alter table public.loyalty_transactions enable row level security;

-- Leitura: mesmo escopo das contas (via join na conta).
drop policy if exists loyalty_transactions_select_staff on public.loyalty_transactions;
create policy loyalty_transactions_select_staff on public.loyalty_transactions for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() in ('admin','receptionist')
      or (
        current_role_name() = 'professional'
        and exists (
          select 1 from public.loyalty_accounts la
          join public.appointments a
            on a.tenant_id = la.tenant_id
           and a.customer_id = la.customer_id
          join public.professionals p
            on p.tenant_id = a.tenant_id
           and p.id = a.professional_id
         where la.tenant_id = loyalty_transactions.tenant_id
           and la.id = loyalty_transactions.account_id
           and p.profile_id = auth.uid()
        )
      )
    )
  );

-- Append-only: UPDATE só pode carimbar estorno lógico; DELETE barrado na app.
create or replace function public.loyalty_transactions_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if auth.uid() is null then
      return old;
    end if;
    raise exception 'HARD_DELETE_FORBIDDEN' using errcode = 'PT403';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.account_id is distinct from old.account_id
     or new.appointment_id is distinct from old.appointment_id
     or new.type is distinct from old.type
     or new.points is distinct from old.points
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    -- expires_at/voided_*: mutáveis só por via server-side (não há policy de
    -- UPDATE p/ authenticated; só definer/service_role/owner alcançam aqui) —
    -- ex.: backfill de expiração e carimbo de estorno lógico.
    raise exception 'LOYALTY_TRANSACTION_IMMUTABLE' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

drop trigger if exists loyalty_transactions_immutable_trg on public.loyalty_transactions;
create trigger loyalty_transactions_immutable_trg
  before update or delete on public.loyalty_transactions
  for each row execute function public.loyalty_transactions_immutable();

-- ============================================================================
-- 4. Entitlement `fidelidade` (server-side; UI usa usePlanEntitlements).
-- ============================================================================
-- tenant_has_feature() já existe (ADR-05 campanhas); reusado, não recriado.
update public.plans
   set features = features || '["fidelidade"]'::jsonb
 where slug in ('premium','enterprise')
   and not (features ? 'fidelidade');

-- ============================================================================
-- 5. Cálculo de pontos (interno, sem grants: só RPCs/trigger chamam).
-- ============================================================================
create or replace function public.loyalty_compute_points(
  p_program public.loyalty_programs,
  p_price_cents int,
  p_service_id uuid
)
returns int
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_rate numeric(10,2) := p_program.points_per_real;
  v_entry jsonb;
begin
  if p_price_cents is null or p_price_cents <= 0 then
    return 0;
  end if;
  if p_service_id is not null then
    v_entry := p_program.service_rules -> p_service_id::text;
    if v_entry is not null and (v_entry ? 'points_per_real') then
      begin
        v_rate := (v_entry ->> 'points_per_real')::numeric;
      exception when others then
        v_rate := p_program.points_per_real;
      end;
      if v_rate is null or v_rate <= 0 then
        v_rate := p_program.points_per_real;
      end if;
    end if;
  end if;
  if p_program.rounding = 'nearest' then
    return round((p_price_cents::numeric / 100.0) * v_rate)::int;
  end if;
  return floor((p_price_cents::numeric / 100.0) * v_rate)::int;
end;
$$;

revoke all on function public.loyalty_compute_points(public.loyalty_programs, int, uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 6. RPCs públicas.
-- ============================================================================

-- Crédito na conclusão (RF-18). Idempotente por (tenant, appointment, credit).
create or replace function public.loyalty_accrue_on_conclude(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_appt public.appointments%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_points int;
  v_expires timestamptz;
begin
  if v_actor is not null then
    v_role := current_role_name();
    if v_role not in ('admin','receptionist','professional') then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  end if;
  if p_appointment_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_actor is not null and v_appt.tenant_id <> current_tenant_id() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if v_appt.status <> 'concluido' then
    raise exception 'APPOINTMENT_NOT_CONCLUDED' using errcode = 'PT409';
  end if;
  if not public.tenant_has_feature(v_appt.tenant_id, 'fidelidade') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  select * into v_program from public.loyalty_programs
   where tenant_id = v_appt.tenant_id;
  if not found or not v_program.active then
    return jsonb_build_object('appointment_id', p_appointment_id,
                              'accrued', false, 'reason', 'program_inactive');
  end if;

  -- Replay: crédito já existe para este atendimento.
  if exists (
    select 1 from public.loyalty_transactions
     where tenant_id = v_appt.tenant_id
       and appointment_id = p_appointment_id
       and type = 'credit'
  ) then
    select * into v_account from public.loyalty_accounts
     where tenant_id = v_appt.tenant_id and customer_id = v_appt.customer_id;
    return jsonb_build_object('appointment_id', p_appointment_id,
                              'accrued', true, 'replayed', true,
                              'balance_points', coalesce(v_account.balance_points, 0));
  end if;

  v_points := public.loyalty_compute_points(v_program, v_appt.price_cents, v_appt.service_id);
  if v_points <= 0 then
    return jsonb_build_object('appointment_id', p_appointment_id,
                              'accrued', false, 'reason', 'zero_points');
  end if;

  if v_program.expiry_days is not null then
    v_expires := now() + (v_program.expiry_days || ' days')::interval;
  end if;

  insert into public.loyalty_accounts (tenant_id, customer_id)
  values (v_appt.tenant_id, v_appt.customer_id)
  on conflict (tenant_id, customer_id) do nothing;

  select * into v_account from public.loyalty_accounts
   where tenant_id = v_appt.tenant_id and customer_id = v_appt.customer_id
   for update;

  insert into public.loyalty_transactions
    (tenant_id, account_id, appointment_id, type, points, reason, expires_at)
  values
    (v_appt.tenant_id, v_account.id, p_appointment_id, 'credit', v_points,
     'conclusao de atendimento', v_expires)
  on conflict (tenant_id, appointment_id, type)
     where appointment_id is not null do nothing;

  -- TOCTOU: concorrente pode ter inserido o crédito entre o EXISTS inicial e
  -- aqui; só mexe no saldo/auditoria se ESTE insert inseriu (FOUND).
  if found then
    update public.loyalty_accounts
       set balance_points = balance_points + v_points,
           lifetime_points = lifetime_points + v_points,
           updated_at = now()
     where id = v_account.id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (v_appt.tenant_id, v_actor, 'loyalty_accrued', 'appointment', p_appointment_id,
            jsonb_build_object('points', v_points, 'account_id', v_account.id));

    select * into v_account from public.loyalty_accounts where id = v_account.id;
    return jsonb_build_object('appointment_id', p_appointment_id,
                              'accrued', true, 'replayed', false,
                              'points', v_points,
                              'balance_points', v_account.balance_points);
  end if;

  select * into v_account from public.loyalty_accounts where id = v_account.id;
  return jsonb_build_object('appointment_id', p_appointment_id,
                            'accrued', true, 'replayed', true,
                            'balance_points', coalesce(v_account.balance_points, 0));
end;
$$;

-- Estorno em cancelamento (RF-22). Lógico: carimba void no crédito + linha `void`.
create or replace function public.loyalty_void_for_cancelled_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_appt public.appointments%rowtype;
  v_credit public.loyalty_transactions%rowtype;
  v_account public.loyalty_accounts%rowtype;
begin
  if v_actor is not null then
    v_role := current_role_name();
    if v_role not in ('admin','receptionist','professional') then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  end if;
  if p_appointment_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_actor is not null and v_appt.tenant_id <> current_tenant_id() then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if v_appt.status <> 'cancelado' then
    raise exception 'APPOINTMENT_NOT_CANCELLED' using errcode = 'PT409';
  end if;
  if not public.tenant_has_feature(v_appt.tenant_id, 'fidelidade') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  select * into v_credit from public.loyalty_transactions
   where tenant_id = v_appt.tenant_id
     and appointment_id = p_appointment_id
     and type = 'credit'
   for update;
  if not found then
    return jsonb_build_object('appointment_id', p_appointment_id,
                              'voided', false, 'reason', 'no_credit');
  end if;
  if v_credit.voided_at is not null then
    return jsonb_build_object('appointment_id', p_appointment_id,
                              'voided', true, 'replayed', true);
  end if;

  update public.loyalty_transactions
     set voided_at = now(), voided_by = v_actor, void_reason = 'cancelamento de atendimento'
   where id = v_credit.id;

  insert into public.loyalty_transactions
    (tenant_id, account_id, appointment_id, type, points, reason)
  values
    (v_appt.tenant_id, v_credit.account_id, p_appointment_id, 'void', v_credit.points,
     'estorno por cancelamento de atendimento')
  on conflict (tenant_id, appointment_id, type)
     where appointment_id is not null do nothing;

  -- TOCTOU: concorrente pode ter inserido o `void` entre o SELECT inicial e
  -- aqui; só mexe no saldo/auditoria se ESTE insert inseriu (FOUND).
  if found then
    select * into v_account from public.loyalty_accounts
     where id = v_credit.account_id for update;

    update public.loyalty_accounts
       set balance_points = greatest(0, balance_points - v_credit.points),
           updated_at = now()
     where id = v_credit.account_id;

    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (v_appt.tenant_id, v_actor, 'loyalty_voided', 'appointment', p_appointment_id,
            jsonb_build_object('points', v_credit.points, 'account_id', v_credit.account_id));

    select * into v_account from public.loyalty_accounts where id = v_credit.account_id;
    return jsonb_build_object('appointment_id', p_appointment_id,
                              'voided', true, 'replayed', false,
                              'points', v_credit.points,
                              'balance_points', v_account.balance_points);
  end if;

  select * into v_account from public.loyalty_accounts where id = v_credit.account_id;
  return jsonb_build_object('appointment_id', p_appointment_id,
                            'voided', true, 'replayed', true,
                            'points', v_credit.points,
                            'balance_points', v_account.balance_points);
end;
$$;

-- Expiração (RF-22; job/cron com service role ou admin). Retorna nº de contas de
-- pontos expiradas neste lote.
create or replace function public.loyalty_expire_sweep(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_limit int := coalesce(p_limit, 200);
  v_count int := 0;
  v_tenant uuid;
  r record;
begin
  if v_actor is not null and current_role_name() <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if v_actor is not null then
    -- Chamador autenticado: restringe o loop ao próprio tenant; service_role
    -- (actor null) varre global (job/cron).
    v_tenant := current_tenant_id();
  end if;
  if v_limit <= 0 then
    v_limit := 200;
  end if;

  for r in
    select c.id, c.tenant_id, c.account_id, c.appointment_id, c.points
      from public.loyalty_transactions c
     where c.type = 'credit'
       and c.voided_at is null
       and c.expires_at is not null
       and c.expires_at < now()
       and (v_tenant is null or c.tenant_id = v_tenant)
       and not exists (
         select 1 from public.loyalty_transactions e
          where e.tenant_id = c.tenant_id
            and e.appointment_id = c.appointment_id
            and e.type = 'expire'
       )
     order by c.expires_at asc
     limit v_limit
     for update skip locked
  loop
    insert into public.loyalty_transactions
      (tenant_id, account_id, appointment_id, type, points, reason)
    values
      (r.tenant_id, r.account_id, r.appointment_id, 'expire', r.points,
       'expiracao de pontos')
    on conflict (tenant_id, appointment_id, type)
       where appointment_id is not null do nothing;
    if found then
      update public.loyalty_accounts
         set balance_points = greatest(0, balance_points - r.points),
             updated_at = now()
       where id = r.account_id;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Saldo + extrato resumido do cliente (aba Fidelidade no CRM, RF-18).
create or replace function public.loyalty_balance(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_account public.loyalty_accounts%rowtype;
begin
  if current_role_name() not in ('admin','receptionist','professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_customer_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if not public.tenant_has_feature(v_tenant, 'fidelidade') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;
  if not exists (
    select 1 from public.customers c
     where c.tenant_id = v_tenant and c.id = p_customer_id
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'PT404';
  end if;
  -- Escopo do professional: replica o predicado da policy
  -- loyalty_accounts_select_staff — só lê saldo de cliente da própria agenda;
  -- recepção/admin sem restrição extra.
  if current_role_name() = 'professional' then
    if not exists (
      select 1 from public.appointments a
        join public.professionals p
          on p.tenant_id = a.tenant_id
         and p.id = a.professional_id
       where a.tenant_id = v_tenant
         and a.customer_id = p_customer_id
         and p.profile_id = auth.uid()
    ) then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  end if;

  select * into v_account from public.loyalty_accounts
   where tenant_id = v_tenant and customer_id = p_customer_id;
  if not found then
    return jsonb_build_object('customer_id', p_customer_id,
                              'balance_points', 0, 'lifetime_points', 0);
  end if;
  return jsonb_build_object('customer_id', p_customer_id,
                            'account_id', v_account.id,
                            'balance_points', v_account.balance_points,
                            'lifetime_points', v_account.lifetime_points);
end;
$$;

-- Grants: RPCs públicas p/ authenticated (job/Edge usa service_role, bypassa).
revoke all on function public.loyalty_accrue_on_conclude(uuid) from public, anon;
grant execute on function public.loyalty_accrue_on_conclude(uuid) to authenticated;

revoke all on function public.loyalty_void_for_cancelled_appointment(uuid) from public, anon;
grant execute on function public.loyalty_void_for_cancelled_appointment(uuid) to authenticated;

revoke all on function public.loyalty_expire_sweep(int) from public, anon;
grant execute on function public.loyalty_expire_sweep(int) to authenticated;

revoke all on function public.loyalty_balance(uuid) from public, anon;
grant execute on function public.loyalty_balance(uuid) to authenticated;

-- ============================================================================
-- 7. Ganchos de status: concluir credita, cancelar estorna.
-- ============================================================================
-- Roda AFTER (a máquina de estados já validou a transição no BEFORE). Pré-checa
-- entitlement + programa ativo para nunca quebrar o UPDATE do atendimento quando
-- a fidelidade está desligada; o resto (idempotência, cálculo) vive nas RPCs.
create or replace function public.loyalty_on_appointment_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_program public.loyalty_programs%rowtype;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('concluido','cancelado') then
    return new;
  end if;
  if not public.tenant_has_feature(new.tenant_id, 'fidelidade') then
    return new;
  end if;
  select * into v_program from public.loyalty_programs
   where tenant_id = new.tenant_id;
  if not found or not v_program.active then
    return new;
  end if;

  if new.status = 'concluido' then
    perform public.loyalty_accrue_on_conclude(new.id);
  elsif new.status = 'cancelado' then
    perform public.loyalty_void_for_cancelled_appointment(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.loyalty_on_appointment_status() from public, anon, authenticated;

drop trigger if exists loyalty_on_appointment_status_trg on public.appointments;
create trigger loyalty_on_appointment_status_trg
  after update of status on public.appointments
  for each row execute function public.loyalty_on_appointment_status();
