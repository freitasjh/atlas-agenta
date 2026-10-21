-- Migration: appointments.confirmed_via — origem da confirmação (ADR-01 Fatia 2, Opção A do PRD §2.4)
-- Hoje `confirmed_at` (carimbado pelo trigger de transição 20250219093000) diz QUANDO o
-- agendamento foi confirmado, mas não QUEM confirmou. O selo "confirmado pelo cliente" na agenda
-- (valor de negócio da fatia, ADR-06) e a distinção no histórico dependem desse dado. A Opção A
-- do PRD (mantida pelo humano) é uma coluna determinística, versionada, sob o RLS existente de
-- `appointments` — em vez de derivar a origem por join frágil com `messages` (Opção B, rejeitada
-- por não ser determinística e expor PII).
--
-- Decisão: `confirmed_via` nullable. NULL = ainda não confirmado OU linha legada (a UI trata
-- ausência como "manual" por padrão — ADR-06). O webhook (ADR-03) grava `cliente_whatsapp` ao
-- casar a resposta "1"; a confirmação pela UI grava `manual`. Não mexer no trigger de transição
-- aqui — ADR-03 decide como o webhook grava `confirmed_via` junto da transição.
--
-- Aditiva e idempotente (`add column if not exists`): não altera migration aplicada, não quebra
-- o insert atual de `appointments` (useCreateAppointment não envia a coluna), não toca RLS nem o
-- índice de exclusão de sobreposição. Sem backfill de origem para linhas antigas (NULL é aceito).
-- Nenhum segredo no SQL.

alter table public.appointments
  add column if not exists confirmed_via text
    check (confirmed_via in ('cliente_whatsapp','manual'));

comment on column public.appointments.confirmed_via is
  'Origem da confirmação: cliente_whatsapp (webhook, resposta 1) | manual (UI) | NULL (não confirmado/legado).';
