-- Migration: estende features do catálogo SSoT com `estoque` e `comissao_produto`
-- (Fase 3 ADR-01, T1.3). Aditiva e idempotente: adiciona os slugs aos planos
-- premium/enterprise quando ausentes. Slugs antigos (`estoque_backbar`) preservados
-- por compatibilidade; o hook `usePlanEntitlements` mapeia os novos.
--
-- Idempotente: re-executável; não duplica slugs; não altera preços/quotas.

update public.plans
  set features = features || '["estoque"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'estoque');

update public.plans
  set features = features || '["comissao_produto"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'comissao_produto');