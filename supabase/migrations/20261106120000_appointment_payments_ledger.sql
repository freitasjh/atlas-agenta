-- Migration: ADR-001 — ledger de recebimento `appointment_payments` + `charges` gateway-only.
-- Aditiva e idempotente (create table/index if not exists, drop index if exists, alter column
-- if not exists). Nenhuma migration já aplicada é editada.
--
-- Separação de responsabilidades (PRD RF-25/RF-28/RF-29):
--   charges             -> cobrança PIX do gateway (intenção/reserva; `pago` é estado do gateway).
--   appointment_payments -> ledger imutável do que foi efetivamente recebido (fonte única de receita).
--
-- Invariantes (SPEC §6):
--   I1 amount_cents > 0 e tip_cents >= 0, inteiros em centavos.
--   I2 method/source restritos aos enums.
--   I3 voided_at/by/reason ou todos nulos, ou todos preenchidos com motivo não vazio.
--   I4 um charge_id no máximo 1x por tenant.
--   I5 (tenant_id, idempotency_key, line_index) único quando a chave existe.
--   I6/I10 no máximo 1 cobrança PIX por (tenant_id, appointment_id), inclusive após paga.
--   I7 atendimento/cobrança/perfis referenciados são do mesmo tenant (FKs compostas) e a
--      cobrança vinculada é a do próprio atendimento da linha (FK de 3 colunas).
--   I8 tenant_id not null.
--   I9 receita só considera voided_at is null (contrato de leitura, coberto por teste).
--
-- Escrita: nenhuma policy/grant para authenticated/anon; só service_role escreve (RLS bypassa).
-- Backfill: idempotente por `not exists (tenant_id, charge_id)` com validação de contagem.

-- ============================================================================
-- 2.1) Alvos de FK composta por tenant para charges.
-- `(tenant_id, id)` continua como alvo genérico; `(tenant_id, id, appointment_id)`
-- é o alvo do vínculo do ledger, que amarra a cobrança ao atendimento da linha.
-- ============================================================================
create unique index if not exists charges_tenant_id_id_uidx
  on public.charges (tenant_id, id);

create unique index if not exists charges_tenant_id_id_appointment_uidx
  on public.charges (tenant_id, id, appointment_id);

-- ============================================================================
-- 2.2) Ledger imutável de recebimento (1:N por atendimento).
-- ============================================================================
create table if not exists public.appointment_payments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default current_tenant_id()
                     references public.tenants (id) on delete cascade,
  appointment_id   uuid not null,
  charge_id        uuid,
  method           text not null check (method in (
                     'dinheiro','cartao_credito','cartao_debito',
                     'pix_sistema','pix_maquininha'
                   )),
  amount_cents     int  not null check (amount_cents > 0),
  tip_cents        int  not null default 0 check (tip_cents >= 0),
  source           text not null default 'manual'
                     check (source in ('manual','asaas')),
  idempotency_key  uuid,
  line_index       smallint not null default 0 check (line_index >= 0 and line_index < 50),
  received_at      timestamptz not null default now(),
  received_by      uuid,
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text,
  created_at       timestamptz not null default now(),

  constraint appointment_payments_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint appointment_payments_charge_fk
    foreign key (tenant_id, charge_id, appointment_id)
    references public.charges (tenant_id, id, appointment_id) on delete restrict,
  constraint appointment_payments_received_by_fk
    foreign key (tenant_id, received_by)
    references public.profiles (tenant_id, id) on delete restrict,
  constraint appointment_payments_voided_by_fk
    foreign key (tenant_id, voided_by)
    references public.profiles (tenant_id, id) on delete restrict,
  constraint appointment_payments_void_consistent check (
    (voided_at is null and voided_by is null and void_reason is null)
    or
    (voided_at is not null and voided_by is not null
     and void_reason is not null and length(btrim(void_reason)) > 0)
  )
);

-- ============================================================================
-- 2.2b) Re-declaração idempotente da FK da cobrança.
-- Repara bancos onde a versão anterior desta migration aplicou a FK de 2 colunas.
-- MATCH SIMPLE (default): com `charge_id` nulo a FK não é verificada.
-- Cobrança com `appointment_id` nulo (assinatura) nunca casa: NULL não é igual ao
-- `appointment_id` da linha, então o vínculo é rejeitado.
-- ============================================================================
alter table public.appointment_payments
  drop constraint if exists appointment_payments_charge_fk;
alter table public.appointment_payments
  add constraint appointment_payments_charge_fk
    foreign key (tenant_id, charge_id, appointment_id)
    references public.charges (tenant_id, id, appointment_id) on delete restrict;

-- ============================================================================
-- 2.3) Unicidade do ledger: 1 recebimento por cobrança + idempotência do lote.
-- ============================================================================
create unique index if not exists appointment_payments_idem_uidx
  on public.appointment_payments (tenant_id, idempotency_key, line_index)
  where idempotency_key is not null;

create unique index if not exists appointment_payments_charge_uidx
  on public.appointment_payments (tenant_id, charge_id)
  where charge_id is not null;

-- ============================================================================
-- 2.4) Cap de 1 PIX do sistema por atendimento (substitui o unique global).
-- Sem predicado de status: não é recriável nem depois de paga (I6/I10).
-- ============================================================================
drop index if exists public.charges_appointment_id_uidx;
create unique index if not exists charges_tenant_appointment_uidx
  on public.charges (tenant_id, appointment_id)
  where appointment_id is not null;

-- ============================================================================
-- 2.5) Retry da criação de cobrança (ADR-003 consome).
-- ============================================================================
alter table public.charges add column if not exists idempotency_key uuid;
create unique index if not exists charges_tenant_idem_uidx
  on public.charges (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- ============================================================================
-- 2.6) Índices de consulta (atendimento, período, método e estorno).
-- ============================================================================
create index if not exists appointment_payments_tenant_appointment_idx
  on public.appointment_payments (tenant_id, appointment_id, received_at);
create index if not exists appointment_payments_tenant_received_idx
  on public.appointment_payments (tenant_id, received_at)
  where voided_at is null;
create index if not exists appointment_payments_tenant_method_received_idx
  on public.appointment_payments (tenant_id, method, received_at)
  where voided_at is null;
create index if not exists appointment_payments_tenant_voided_idx
  on public.appointment_payments (tenant_id, voided_at)
  where voided_at is not null;

-- ============================================================================
-- 2.7) RLS + grants: leitura direta só admin do tenant; escrita só service_role.
-- ============================================================================
alter table public.appointment_payments enable row level security;

drop policy if exists appointment_payments_select_tenant_admin on public.appointment_payments;
create policy appointment_payments_select_tenant_admin on public.appointment_payments
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.appointment_payments from anon, authenticated;
grant select on table public.appointment_payments to authenticated;
grant all on table public.appointment_payments to service_role;

-- ============================================================================
-- 2.8) Backfill dos charges pagos (1 linha por cobrança paga com atendimento).
-- Idempotente por not exists (tenant_id, charge_id); divergência de contagem aborta.
-- ============================================================================
do $$
declare
  faltantes_antes       bigint;
  inseridas             bigint;
  pagas_sem_atendimento bigint;
  pagas_sem_valor       bigint;
begin
  -- Guarda (D-02): cobrança paga com valor <= 0 não pode gerar linha (violaria
  -- amount_cents > 0) nem ser ignorada em silêncio (violaria o 1:1 de RF-09).
  select count(*) into pagas_sem_valor
    from public.charges c
   where c.status = 'pago' and c.appointment_id is not null and c.amount_cents <= 0;
  if pagas_sem_valor > 0 then
    raise exception 'backfill appointment_payments: % cobranca(s) paga(s) com amount_cents <= 0; corrigir a origem antes da migration', pagas_sem_valor;
  end if;

  select count(*) into faltantes_antes
    from public.charges c
   where c.status = 'pago'
     and c.appointment_id is not null
     and not exists (
       select 1 from public.appointment_payments p
        where p.tenant_id = c.tenant_id and p.charge_id = c.id
     );

  insert into public.appointment_payments
    (tenant_id, appointment_id, charge_id, method, amount_cents, tip_cents,
     source, received_at, received_by)
  select c.tenant_id, c.appointment_id, c.id, 'pix_sistema', c.amount_cents, 0,
         'asaas', coalesce(c.paid_at, c.created_at), null
    from public.charges c
   where c.status = 'pago'
     and c.appointment_id is not null
     and not exists (
       select 1 from public.appointment_payments p
        where p.tenant_id = c.tenant_id and p.charge_id = c.id
     );

  get diagnostics inseridas = row_count;

  select count(*) into pagas_sem_atendimento
    from public.charges c
   where c.status = 'pago' and c.appointment_id is null;

  raise notice 'backfill appointment_payments: % paga(s) sem atendimento fora do ledger', pagas_sem_atendimento;

  if inseridas <> faltantes_antes then
    raise exception 'backfill appointment_payments divergente: faltantes_antes=%, inseridas=%',
      faltantes_antes, inseridas;
  end if;
end;
$$;
