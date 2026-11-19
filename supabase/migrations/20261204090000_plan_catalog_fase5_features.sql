-- Migration: estende features do catálogo SSoT com as 8 capacidades da Fase 5
-- (ADR-01, T1.4/T1.5): `nfce`, `recorrencia`, `contas_pagar`, `conciliacao`,
-- `dre_fluxo`, `export_contabil`, `backoffice_t14`, `backoffice_t15`.
-- Aditiva e idempotente: adiciona os slugs aos planos premium/enterprise quando
-- ausentes. `backoffice_t14/t15` alimentam o back-office internal-admin (ADR-11);
-- o hook `usePlanEntitlements` mapeia as 8 flags para o contrato de 18 chaves.
--
-- Idempotente: re-executável; não duplica slugs; não altera preços/quotas;
-- nenhuma tabela nova, nenhuma RPC nova, RLS intocado.

update public.plans
  set features = features || '["nfce"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'nfce');

update public.plans
  set features = features || '["recorrencia"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'recorrencia');

update public.plans
  set features = features || '["contas_pagar"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'contas_pagar');

update public.plans
  set features = features || '["conciliacao"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'conciliacao');

update public.plans
  set features = features || '["dre_fluxo"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'dre_fluxo');

update public.plans
  set features = features || '["export_contabil"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'export_contabil');

update public.plans
  set features = features || '["backoffice_t14"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'backoffice_t14');

update public.plans
  set features = features || '["backoffice_t15"]'::jsonb
where slug in ('premium', 'enterprise')
  and not (features ? 'backoffice_t15');
