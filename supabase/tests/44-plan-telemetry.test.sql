-- Telemetria de planos (plan-telemetry-pacote): guards + semântica + PII + catálogo.
--
-- Padrão do harness (00-helpers.sql): negativos com o papel real `authenticated`
-- via tests.authenticate_as; tudo em transação com rollback.
create extension if not exists pgtap with schema extensions;

begin;

select plan(20);

-- Fixture: tenant A (admin A, plano individual, ativo) com 2 profs ativos
-- (acima do teto 1 → quente) + tenant B (clinica, ativo) + super_admin S.
select tests.create_user(
  '61515151-5151-4515-8515-515151515151',
  'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2',
  'admin',
  'Ana Admin'
);
select tests.create_user(
  '62525252-5252-4525-8525-525252525252',
  'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2',
  'admin',
  'Beto Admin'
);
select tests.create_user(
  '64545454-5454-4545-8545-545454545454',
  'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2',
  'super_admin',
  'Sofia Super'
);

update public.tenants set plan = 'individual', subscription_status = 'ativo',
  timezone = 'America/Sao_Paulo'
 where id = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
update public.tenants set plan = 'clinica', subscription_status = 'ativo',
  timezone = 'America/Sao_Paulo'
 where id = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';

insert into public.professionals (tenant_id, name, active) values
  ('a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'Paulo', true),
  ('b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'Bia', true);

-- Catálogo: 4 views security_invoker + sem SELECT anon/authenticated.
select ok(
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('v_plan_mrr','v_trial_conversion_por_plano','v_quota_utilization','v_churn_por_plano')
     and 'security_invoker=true' = any(c.reloptions)) = 4,
  'views de telemetria com security_invoker=true'
);
select ok(
  not has_table_privilege('anon', 'public.v_plan_mrr', 'SELECT')
  and not has_table_privilege('authenticated', 'public.v_plan_mrr', 'SELECT')
  and not has_table_privilege('anon', 'public.v_trial_conversion_por_plano', 'SELECT')
  and not has_table_privilege('authenticated', 'public.v_trial_conversion_por_plano', 'SELECT')
  and not has_table_privilege('anon', 'public.v_quota_utilization', 'SELECT')
  and not has_table_privilege('authenticated', 'public.v_quota_utilization', 'SELECT')
  and not has_table_privilege('anon', 'public.v_churn_por_plano', 'SELECT')
  and not has_table_privilege('authenticated', 'public.v_churn_por_plano', 'SELECT'),
  'anon e authenticated sem SELECT nas 4 views'
);

-- Catálogo: RPCs com EXECUTE só authenticated (service_role bypassa; anon fora).
select ok(
  has_function_privilege('authenticated', 'public.admin_get_plan_mrr(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_get_trial_conversion(date, date, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_get_quota_utilization(numeric)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_get_churn_por_plano(text)', 'EXECUTE'),
  'authenticated com EXECUTE nos 4 RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.admin_get_plan_mrr(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_get_quota_utilization(numeric)', 'EXECUTE'),
  'anon sem EXECUTE nos RPCs'
);

-- Paridade preço: CASE trava 5900/14900/25900 (espelho plans.json).
select ok(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'plan_price_cents'
     and pg_get_functiondef(p.oid) like '%5900%'
     and pg_get_functiondef(p.oid) like '%14900%'
     and pg_get_functiondef(p.oid) like '%25900%') = 1,
  'plan_price_cents trava os 3 literais do plans.json'
);

-- PII: nenhuma view/RPC expõe owner_email/phone/document.
select is(
  (select count(*)::int from (
    select pg_get_viewdef(c.oid) as src from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('v_plan_mrr','v_trial_conversion_por_plano','v_quota_utilization','v_churn_por_plano')
  ) v where v.src ilike '%owner_email%' or v.src ilike '%phone%' or v.src ilike '%document%'),
  0,
  'views sem PII (owner_email/phone/document)'
);
select is(
  (select count(*)::int from (
    select pg_get_functiondef(p.oid) as src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_get_plan_mrr','admin_get_trial_conversion','admin_get_quota_utilization','admin_get_churn_por_plano')
  ) f where f.src ilike '%owner_email%' or f.src ilike '%phone%' or f.src ilike '%document%'),
  0,
  'RPCs sem PII (owner_email/phone/document)'
);

-- Guard: anon (sem JWT) recebe null nos RPCs jsonb.
select tests.authenticate_as('61515151-5151-4515-8515-515151515151', 'authenticated');
-- (admin A autenticado: jsonb RPCs devolvem null; quota levanta forbidden)
select is(
  public.admin_get_plan_mrr(to_char(now(), 'YYYY-MM')),
  null,
  'admin do tenant recebe null no MRR (guard super_admin)'
);
select is(
  public.admin_get_churn_por_plano(to_char(now(), 'YYYY-MM')),
  null,
  'admin do tenant recebe null no churn (guard super_admin)'
);
select throws_ok(
  $$select * from public.admin_get_quota_utilization(0.8)$$,
  '42501', 'forbidden',
  'admin do tenant negado na quota (insufficient_privilege)'
);
reset role;
select tests.clear_authentication();

-- Guard: view direta negada para admin do tenant (42501).
select tests.authenticate_as('61515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$select * from public.v_plan_mrr$$,
  '42501', 'permission denied for view v_plan_mrr',
  'admin do tenant não lê v_plan_mrr direto (revogada)'
);
reset role;
select tests.clear_authentication();

-- Semântica: super_admin vê MRR = ativos × preço (1 ind + 1 cli = 5900+14900).
select tests.authenticate_as('64545454-5454-4545-8545-545454545454', 'authenticated');
select is(
  (public.admin_get_plan_mrr(to_char(now(), 'YYYY-MM'))->>'mrr_cents')::bigint,
  5900::bigint + 14900::bigint,
  'MRR = ativos × preço (individual + clinica)'
);
select is(
  (public.admin_get_plan_mrr(to_char(now(), 'YYYY-MM'))->>'base_ativa')::int,
  2,
  'base ativa = 2 tenants ativos'
);
-- Quota: tenant A no teto (1/1 profs) aparece quente.
select is(
  (select count(*)::int from public.admin_get_quota_utilization(0.8)
    where tenant_id = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'),
  1,
  'tenant no teto aparece na quota quente'
);
-- Validação server-side: mês inválido e plano inválido negam check_violation.
select throws_ok(
  $$select public.admin_get_plan_mrr('2026-13')$$,
  '23514', 'invalid_month',
  'mês inválido nega check_violation'
);
select throws_ok(
  $$select public.admin_get_trial_conversion('2026-01-01'::date, '2026-01-31'::date, 'diamond')$$,
  '23514', 'invalid_plan',
  'plano inválido nega check_violation'
);
select throws_ok(
  $$select public.admin_get_trial_conversion('2026-02-01'::date, '2026-01-01'::date, null)$$,
  '23514', 'invalid_range',
  'período invertido nega check_violation'
);
reset role;
select tests.clear_authentication();

-- EXPLAIN: plano da quota gera sem erro e usa pré-agregação (GROUP BY, sem LATERAL).
select lives_ok(
  $$explain select * from public.v_quota_utilization$$,
  'EXPLAIN da v_quota_utilization executa'
);
select ok(
  (select pg_get_viewdef(c.oid) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'v_quota_utilization') not ilike '%lateral%',
  'v_quota_utilization sem LATERAL (GROUP BY pré-agregado)'
);
select ok(
  (select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_get_quota_utilization') ilike '%limit 100%',
  'quota RPC com LIMIT 100'
);

select * from finish();
rollback;
