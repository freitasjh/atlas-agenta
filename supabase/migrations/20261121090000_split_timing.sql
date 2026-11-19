-- ============================================================================
-- ADR-06 (roadmap-fase3/salao-barbearia) — Split-timing (processamento) backend.
--
-- Adiciona `processing_minutes` separado de `duration_minutes` em `services` e
-- `appointments`. O atendimento (duration) continua definindo `ends_at` e a
-- anti-sobreposição do profissional (constraint appointments_no_overlap,
-- inalterada). O processamento ocorre após `ends_at` e não bloqueia a agenda do
-- profissional; bloqueia o recurso vinculado (ADR-07).
--
-- Idempotente: add column if not exists, trigger drop/create, backfill where null.
-- `db reset` re-executável. Nenhuma mudança em RLS, machine de estados, ledger.
-- ============================================================================

-- 1) services: default por serviço (default 0).
alter table public.services
  add column if not exists processing_minutes int not null default 0
  check (processing_minutes >= 0);

-- 2) appointments: snapshot do processamento no ato (herança server-side). Sem
-- default de coluna: o valor é herdado do serviço no INSERT via trigger; o NOT
-- NULL é garantido pelo trigger (coalesce final 0). Isso permite distinguir
-- "cliente não informou" (NULL no BEFORE trigger) de "informou 0".
alter table public.appointments
  add column if not exists processing_minutes int
  check (processing_minutes >= 0);

-- backfill: appointments existentes sem valor recebem 0 (snapshot preservado).
update public.appointments
   set processing_minutes = 0
 where processing_minutes is null;

alter table public.appointments
  alter column processing_minutes set not null;

-- Sem default de coluna: o valor é herdado do serviço no INSERT (trigger). Se
-- houvesse default 0, o BEFORE trigger veria 0 (não NULL) e não herdaria.
alter table public.appointments
  alter column processing_minutes drop default;

-- 3) Herança server-side no INSERT: appointment herda do service quando não
-- informado; combo (service_id null) cai para 0. Cliente não fornece.
create or replace function public.appointments_set_processing()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.processing_minutes := coalesce(
    new.processing_minutes,
    (select s.processing_minutes
       from public.services s
      where s.tenant_id = new.tenant_id
        and s.id = new.service_id),
    0
  );
  return new;
end;
$$;

drop trigger if exists appointments_set_processing on public.appointments;
create trigger appointments_set_processing
  before insert on public.appointments
  for each row
  execute function public.appointments_set_processing();

-- 4) Guard de imutabilidade do snapshot (opcional, consistente com
-- commission_base_cents): barra alteração após o INSERT.
create or replace function public.appointments_freeze_processing()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.processing_minutes is distinct from old.processing_minutes then
    raise exception 'processing_minutes e imutavel apos o agendamento'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_freeze_processing on public.appointments;
create trigger appointments_freeze_processing
  before update of processing_minutes on public.appointments
  for each row
  execute function public.appointments_freeze_processing();