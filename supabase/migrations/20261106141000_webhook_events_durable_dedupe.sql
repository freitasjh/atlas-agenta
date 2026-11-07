-- Migration: ADR-003 — dedupe durável de `webhook_events` para o Asaas.
-- Idempotente. Não altera RLS nem grants.

-- 1) Evento inserido sem `processed_at` passa a ser "não processado".
--    O default antigo (`now()`) fazia uma falha parecer sucesso e perdia o retry at-least-once.
alter table public.webhook_events alter column processed_at drop default;

-- 2) A fonte do Asaas deixa de se disfarçar de 'evolution'.
alter table public.webhook_events drop constraint if exists webhook_events_source_check;
alter table public.webhook_events add constraint webhook_events_source_check
  check (source in ('evolution', 'asaas'));

-- 3) Observabilidade de eventos presos (nunca processados).
create index if not exists webhook_events_asaas_pending_idx
  on public.webhook_events (created_at)
  where payment_id is not null and processed_at is null;
