-- Migration: idempotency_key tenant-scoped em subscription_charges (ADR-10 Fase 4, correção A1).
--
-- Problema: o índice `subscription_charges_idempotency_key_uidx` era único
-- GLOBAL em (idempotency_key). Duas tenants usando a mesma chave (uuid
-- gerado no cliente, colisão cross-tenant possível) batiam em 23505 no
-- INSERT, e o handler só encontra a cobrança do próprio tenant no fallback —
-- resultado: 500 "Falha ao registrar o agendamento" para a segunda tenant.
--
-- Fix: unicidade em (tenant_id, idempotency_key). Retry da mesma tenant
-- continua idempotente (fallback por tenant+chave no handler); tenants
-- distintas com a mesma chave inserem sem conflito.
--
-- Nome do índice preservado (o pgTAP 61-my-plan-checkout prova a existência
-- pelo nome). Seguro: o índice antigo já garantia unicidade global, logo não
-- há duplicata (tenant_id, idempotency_key) pré-existente que impeça o novo.
-- Idempotente (drop/create if exists). Nenhum segredo.

drop index if exists public.subscription_charges_idempotency_key_uidx;

create unique index if not exists subscription_charges_idempotency_key_uidx
  on public.subscription_charges (tenant_id, idempotency_key)
  where idempotency_key is not null;

comment on index public.subscription_charges_idempotency_key_uidx is
  'ADR-10 A1: idempotencia por tenant — retry mesma tenant devolve a cobranca existente; tenants distintas podem reutilizar a chave sem 23505.';
