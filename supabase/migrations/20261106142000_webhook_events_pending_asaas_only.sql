-- Migration: ADR-003 — o índice de eventos pendentes passa a ser só da fonte Asaas.
-- Idempotente: recria o índice com o mesmo nome usado por 20261106141000, sem alterar
-- a migration anterior (que pode já ter sido aplicada em outro ambiente).
--
-- Motivo: `processed_at` é a fonte de retry do Asaas. Eventos do WhatsApp
-- (`source='evolution'`) não usam essa coluna para reprocessar, então entravam no índice
-- como "pendentes" para sempre e poluíam o monitoramento do runbook.

drop index if exists public.webhook_events_asaas_pending_idx;

create index if not exists webhook_events_asaas_pending_idx
  on public.webhook_events (created_at)
  where payment_id is not null
    and processed_at is null
    and source = 'asaas';

comment on index public.webhook_events_asaas_pending_idx is
  'ADR-003: eventos Asaas sem processed_at (retry at-least-once); exclui source=evolution.';
