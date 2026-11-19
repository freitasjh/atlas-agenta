-- Migration: pacotes de sessões da estética (ADR-02 Fase 2) — 1 tabela + RPCs venda/baixa/saldo.
--
-- Escopo (ADR-02, PRD G6 + defaults §8 #1/#2/#3/#6/#8, UX-SPEC T3): pacote = 1 serviço,
-- N sessões, validade contada DESDE A VENDA; baixa de 1 sessão é efeito automático da
-- transição a `concluido` (mesmo commit, via trigger); `cancelado` NÃO estorna; crédito
-- vencido ou zerado recusa a baixa com erro tipado (venda nova resolve); recepção vende
-- mas não executa baixa direta; comissão apurada sobre o preço cheio (sem mudança no motor —
-- o trigger de conclusão já lê `commission_base_cents`, intocado aqui).
--
-- ÚNICA migration nova da Fase 2 (ADR-02 § Escopo). Nenhuma migration aplicada é editada;
-- `appointments_validate_transition()` é recriada com `create or replace` PRESERVANDO o corpo
-- vigente (máquina de estados + carimbo + comissão snapshot G1) e acrescendo SÓ o bloco de
-- baixa de pacote — mesmo padrão da 20250226092000 (comissão) e da G1 (snapshot).
--
-- Modelo:
--   package_credits — crédito de pacote por cliente (1 linha por venda; sem DELETE físico,
--     sem UPDATE de valor: correção é venda nova; `used_sessions` só anda via baixa).
--   appointments.package_credit_id — vínculo opcional (nulo = avulso) com FK COMPOSTA por
--     tenant (coerência no schema, não só na UI), on delete restrict (protege histórico).
--   `status`: 'exhausted' gravado no consumo que zera o saldo; NUNCA grava
--     status='expired' — vencimento é só flag ao vivo em get_package_balance
--     (a recusa aborta o statement e reverte marcação oportunista na mesma
--     transação — por isso sem UPDATE antes do RAISE). O valor 'expired' permanece
--     no CHECK como enum morto: reservado para cron/Edge futuro de expiração ou
--     remoção posterior em migration própria — não remover agora.
--   RPCs SECURITY DEFINER (única via de escrita para authenticated; tabela sem policy de
--     escrita): sell_package (admin/receptionist), redeem_session (admin/professional —
--     recepção recebe 42501), get_package_balance (leitura, SECURITY INVOKER sob RLS).
--   Trigger: ao ENTRAR em 'concluido' com vínculo, consome 1 via rotina interna SEM gate de
--     papel — a baixa é efeito automático do ato de concluir (precedente: comissão, que também
--     não tem gate de papel no trigger). O gate de papel vive na chamada DIRETA (redeem_session).
--     Default §8 #6 = recepção não tem ação manual de baixa (só venda); o concluir continua
--     operável por quem a RLS de appointments permite.
--
-- Fronteiras: tenant_id SEMPRE de current_tenant_id() (JWT/profiles), nunca do cliente;
-- RLS on + SELECT por tenant; dinheiro em *_cents inteiro; tempos timestamptz UTC; sem PII
-- em mensagem de erro (mensagens fixas, sem eco de valor/linha); nenhum segredo no SQL.
-- Idempotente no re-apply (if not exists / drop if exists / or replace). `db reset` 2x verde.
-- Baixa idempotente por construção: 'concluido' é final (sem saída), logo o bloco dispara
-- no máximo 1x por atendimento; redeem direto no mesmo atendimento concluído recusa
-- (já consumido => segunda chamada veria atendimento sem vínculo novo? NÃO — ver nota).
-- Nota de idempotência do redeem direto: o vínculo é 1 atendimento -> 1 crédito; chamar
-- redeem 2x para o MESMO atendimento consumiria 2x. O caminho suportado é o trigger (1x,
-- garantido pelo estado final). O redeem direto exige atendimento 'concluido' e é trilha
-- de contingência (Edge/reparo); o teste cobre que o trigger não duplica e que o direto
-- em atendimento já-concluído-via-trigger consome NOVA sessão (comportamento explícito,
-- não silencioso) — por isso a UI nunca chama redeem direto após concluir.

-- ============================================================================
-- 1) package_credits — crédito de pacote por cliente.
-- ============================================================================
create table if not exists public.package_credits (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id()
                    references public.tenants (id) on delete cascade,
  customer_id     uuid not null,
  service_id      uuid not null,
  total_sessions  int not null check (total_sessions > 0),
  used_sessions   int not null default 0 check (used_sessions >= 0),
  price_cents     int not null check (price_cents >= 0),
  validity_days   int not null check (validity_days > 0),
  expires_at      timestamptz not null,
  status          text not null default 'active'
                    check (status in ('active','exhausted','expired')),
  created_at      timestamptz not null default now(),
  constraint package_credits_used_within_total check (used_sessions <= total_sessions),
  -- alvo da FK composta de appointments (coerência de tenant no banco).
  constraint package_credits_tenant_id_unique unique (tenant_id, id),
  constraint package_credits_customer_fk
    foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint package_credits_service_fk
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete restrict
);

create index if not exists package_credits_tenant_customer_idx
  on public.package_credits (tenant_id, customer_id, expires_at);
create index if not exists package_credits_tenant_service_idx
  on public.package_credits (tenant_id, service_id);

alter table public.package_credits enable row level security;

-- SELECT: qualquer papel operacional do tenant lê (preço é dado operacional; a UI filtra
-- o preço para recepção — RLS igual, ADR-02). Sem policy de escrita: escrita só via RPCs.
drop policy if exists package_credits_select_same_tenant on public.package_credits;
create policy package_credits_select_same_tenant on public.package_credits for select
  using (tenant_id = current_tenant_id());

revoke all on table public.package_credits from anon, authenticated;
grant select on table public.package_credits to authenticated;
grant all on table public.package_credits to service_role;

-- ============================================================================
-- 2) Vínculo opcional atendimento -> crédito (nulo = avulso).
-- ============================================================================
alter table public.appointments
  add column if not exists package_credit_id uuid;

alter table public.appointments
  drop constraint if exists appointments_package_credit_fk;
alter table public.appointments
  add constraint appointments_package_credit_fk
    foreign key (tenant_id, package_credit_id)
    references public.package_credits (tenant_id, id) on delete restrict;

create index if not exists appointments_tenant_package_credit_idx
  on public.appointments (tenant_id, package_credit_id)
  where package_credit_id is not null;

-- ============================================================================
-- 3) Rotina interna de consumo (gate de papel na via direta; trigger bypassa).
-- ============================================================================
-- p_skip_status_check: o trigger (BEFORE) chama com true na transição a 'concluido',
-- quando a linha ainda guarda o status antigo — a guarda de transição já garante o
-- destino, e a baixa é efeito automático (precedente: comissão, sem gate de papel).
-- A via direta (p_skip_status_check=false) exige admin/professional — recepção recebe
-- 42501 PACKAGE_REDEEM_DENIED. redeem_session mantém o próprio gate (defesa em
-- profundidade). A via direta (redeem_session) exige 'concluido' gravado.
create or replace function public.package_consume(p_credit_id uuid, p_appointment_id uuid, p_skip_status_check boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant    uuid;
  v_credit    public.package_credits%rowtype;
  v_customer  uuid;
  v_service   uuid;
  v_status    text;
begin
  v_tenant := current_tenant_id();
  if v_tenant is null then
    raise exception 'package consume requires authenticated tenant context'
      using errcode = '42501';
  end if;

  -- Só o trigger (profundidade > 0) pode usar skip=true; chamada direta com
  -- skip=true seria bypass de papel + status check (recepção pula o gate).
  if coalesce(p_skip_status_check, false) and pg_trigger_depth() = 0 then
    raise exception 'PACKAGE_REDEEM_DENIED'
      using errcode = '42501';
  end if;

  -- Gate interno da via direta: o trigger passa p_skip_status_check=true e segue
  -- sem gate (efeito automático do concluir); chamada direta exige admin/professional.
  if not coalesce(p_skip_status_check, false) and coalesce(current_role_name(), '__none') not in ('admin','professional') then
    raise exception 'PACKAGE_REDEEM_DENIED'
      using errcode = '42501';
  end if;

  select a.customer_id, a.service_id, a.status
    into v_customer, v_service, v_status
    from public.appointments a
   where a.tenant_id = v_tenant and a.id = p_appointment_id;
  if not found then
    raise exception 'PACKAGE_APPOINTMENT_NOT_FOUND'
      using errcode = 'P0001';
  end if;
  if not coalesce(p_skip_status_check, false) and v_status <> 'concluido' then
    raise exception 'PACKAGE_APPOINTMENT_NOT_CONCLUDED'
      using errcode = 'P0001';
  end if;

  select * into v_credit
    from public.package_credits c
   where c.tenant_id = v_tenant and c.id = p_credit_id
   for update;
  if not found then
    raise exception 'PACKAGE_CREDIT_NOT_FOUND'
      using errcode = 'P0001';
  end if;
  if v_credit.customer_id <> v_customer or v_credit.service_id <> v_service then
    raise exception 'PACKAGE_CREDIT_MISMATCH'
      using errcode = 'P0001';
  end if;
  if v_credit.expires_at <= now() then
    raise exception 'PACKAGE_CREDIT_EXPIRED'
      using errcode = 'P0001';
  end if;
  if v_credit.used_sessions >= v_credit.total_sessions then
    raise exception 'PACKAGE_CREDIT_EXHAUSTED'
      using errcode = 'P0001';
  end if;

  update public.package_credits
     set used_sessions = used_sessions + 1,
         status = case
                    when used_sessions + 1 >= total_sessions then 'exhausted'
                    else status
                  end
   where tenant_id = v_tenant and id = p_credit_id;
end;
$$;

revoke all on function public.package_consume(uuid, uuid, boolean) from public, anon;
grant execute on function public.package_consume(uuid, uuid, boolean) to authenticated, service_role;

-- ============================================================================
-- 4) sell_package — venda (admin/receptionist). Validade desde a venda.
-- ============================================================================
create or replace function public.sell_package(
  p_customer_id uuid, p_service_id uuid,
  p_total_sessions int, p_price_cents int, p_validity_days int
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_id     uuid;
begin
  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') not in ('admin','receptionist') then
    raise exception 'PACKAGE_SELL_DENIED'
      using errcode = '42501';
  end if;
  if p_total_sessions is null or p_total_sessions <= 0
     or p_price_cents is null or p_price_cents < 0
     or p_validity_days is null or p_validity_days <= 0 then
    raise exception 'package sale requires total>0, price>=0 and validity>0'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.customers c
     where c.tenant_id = v_tenant and c.id = p_customer_id
  ) then
    raise exception 'PACKAGE_CUSTOMER_NOT_FOUND'
      using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.services s
     where s.tenant_id = v_tenant and s.id = p_service_id and s.active
  ) then
    raise exception 'PACKAGE_SERVICE_NOT_FOUND_OR_INACTIVE'
      using errcode = '23503';
  end if;

  insert into public.package_credits
    (tenant_id, customer_id, service_id, total_sessions, used_sessions,
     price_cents, validity_days, expires_at, status)
  values
    (v_tenant, p_customer_id, p_service_id, p_total_sessions, 0,
     p_price_cents, p_validity_days, now() + make_interval(days => p_validity_days), 'active')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.sell_package(uuid, uuid, int, int, int) from public, anon;
grant execute on function public.sell_package(uuid, uuid, int, int, int) to authenticated, service_role;

-- ============================================================================
-- 5) redeem_session — baixa direta (admin/professional; recepção recebe 42501).
-- ============================================================================
create or replace function public.redeem_session(p_credit_id uuid, p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_role_name(), '__none') not in ('admin','professional') then
    raise exception 'PACKAGE_REDEEM_DENIED'
      using errcode = '42501';
  end if;
  perform public.package_consume(p_credit_id, p_appointment_id);
end;
$$;

revoke all on function public.redeem_session(uuid, uuid) from public, anon;
grant execute on function public.redeem_session(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 6) get_package_balance — saldo por cliente (leitura sob RLS do chamador).
-- ============================================================================
create or replace function public.get_package_balance(p_customer_id uuid)
returns table (
  credit_id      uuid,
  service_id     uuid,
  total_sessions int,
  used_sessions  int,
  remaining      int,
  expires_at     timestamptz,
  expired        boolean,
  status         text
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.service_id, c.total_sessions, c.used_sessions,
         c.total_sessions - c.used_sessions,
         c.expires_at, c.expires_at <= now(), c.status
    from public.package_credits c
   where c.tenant_id = current_tenant_id()
     and c.customer_id = p_customer_id
   order by c.expires_at;
$$;

revoke all on function public.get_package_balance(uuid) from public, anon;
grant execute on function public.get_package_balance(uuid) to authenticated, service_role;

-- ============================================================================
-- 7) Recria a máquina de estados PRESERVANDO o corpo vigente (G1) + bloco de pacote.
-- Único acréscimo: após a comissão, se a transição entra em 'concluido' com vínculo,
-- consome 1 sessão no mesmo commit. Cancelado/nao_compareceu: nada (sem estorno).
-- ============================================================================
create or replace function public.appointments_validate_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Sem mudança de estado: UPDATE de outros campos (ex.: corrigir starts_at) passa sem a guarda.
  if new.status = old.status then
    return new;
  end if;

  -- Estados finais são imutáveis: nenhuma saída é permitida.
  if old.status in ('concluido','cancelado','nao_compareceu') then
    raise exception 'Transicao de status invalida: % e um estado final e nao pode mudar para %',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Transições permitidas a partir de cada estado não-final (ver diagrama no cabeçalho).
  if not (
    (old.status = 'pendente'
      and new.status in ('confirmado','em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'confirmado'
      and new.status in ('em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'em_atendimento'
      and new.status in ('concluido','cancelado'))
  ) then
    raise exception 'Transicao de status invalida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Efeito colateral (P1): ao entrar em 'confirmado', carimbar confirmed_at uma única vez.
  if new.status = 'confirmado' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;

  -- Efeito colateral (Fase 1b, ADR-03): comissão snapshot sobre commission_base_cents (G1).
  if new.status = 'concluido' and old.status <> 'concluido' then
    insert into appointment_commissions
      (tenant_id, appointment_id, professional_id, base_cents, commission_pct, commission_cents)
    select
      new.tenant_id, new.id, new.professional_id, new.commission_base_cents,
      coalesce(pc.commission_pct, 0),
      round( (new.commission_base_cents * coalesce(pc.commission_pct, 0)) / 100.0 )::int
    from (select 1) dummy
    left join professional_commissions pc
      on pc.tenant_id = new.tenant_id and pc.professional_id = new.professional_id
    on conflict (tenant_id, appointment_id) do nothing;
  end if;

  -- ==========================================================================
  -- Efeito colateral (Fase 2, ADR-02): ao ENTRAR em 'concluido' com vínculo de pacote,
  -- baixa 1 sessão no MESMO commit. Erro tipado (P0001 PACKAGE_CREDIT_*) aborta o
  -- concluir — a UI oferece venda nova/avulso. Cancelado não passa aqui: sem estorno.
  -- Comissão acima é intocada (preço cheio, default §8 #8).
  -- ==========================================================================
  if new.status = 'concluido' and old.status <> 'concluido'
     and new.package_credit_id is not null then
    perform public.package_consume(new.package_credit_id, new.id, true);
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_transition_guard on public.appointments;
create trigger appointments_transition_guard
  before update of status on public.appointments
  for each row
  execute function public.appointments_validate_transition();
