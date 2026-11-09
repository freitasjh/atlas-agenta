-- Hardening do backoffice plan control (code-review loop 1/3, 🔴 C1/C2/C3).
--
--  C1. View v_charges_pagas_sem_plano: security_invoker + REVOKE anon/
--      authenticated; único caminho = RPC admin_get_plan_divergences
--      (guard super_admin interno). Tenant comum não lê nada pela view
--      (42501) nem pelo RPC (insufficient_privilege).
--  C2. tenant_plan_usage(): sem EXECUTE para authenticated; backoffice usa
--      admin_get_tenant_plan (regressão: wrapper continua vivo).
--  C3. Triggers PLAN_LIMIT cobrem UPDATE: reativar profissional além do
--      teto nega; tirar appointment de cancelado com bucket cheio nega;
--      cancelar e mudar de mês continuam livres.
--
-- Padrão do harness (00-helpers.sql): negativos com o papel real
-- `authenticated` via tests.authenticate_as; tudo em transação com rollback.
create extension if not exists pgtap with schema extensions;

begin;

select plan(17);

-- Fixture (domínio .invalido): tenant A (admin A, plano individual),
-- tenant C (super_admin S).
select tests.create_user(
  '51515151-5151-4515-8515-515151515151',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'admin',
  'Ana Admin'
);
select tests.create_user(
  '54545454-5454-4545-8545-545454545454',
  'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
  'super_admin',
  'Sofia Super'
);

-- Fuso fixo para bucket mensal determinístico (fuso do tenant).
update public.tenants set timezone = 'America/Sao_Paulo'
 where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

-- Profissionais: P1 ativo, P2 inativo (teto individual = 1).
insert into public.professionals (id, tenant_id, name, active) values
  ('11111111-1111-4111-8111-111111111111',
   'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'Paulo Ativo', true),
  ('22222222-2222-4222-8222-222222222222',
   'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'Paula Inativa', false);

-- Serviço + cliente do tenant A para os appointments.
insert into public.services (id, tenant_id, name, duration_minutes, price_cents) values
  ('33333333-3333-4333-8333-333333333333',
   'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'Corte', 30, 0);
insert into public.customers (id, tenant_id, name, phone) values
  ('44444444-4444-4444-8444-444444444444',
   'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'Carlos Cliente', '5511999999999');

-- 150 confirmados no mês corrente (fuso SP, slots adjacentes de 30min, sem
-- sobreposição para a exclusion de no-overlap). Teto individual = 150.
insert into public.appointments
  (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
select
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    + (g || ' minutes')::interval,
  (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    + (g || ' minutes')::interval + interval '30 minutes',
  0, 'confirmado'
from generate_series(0, 149 * 30, 30) g;

-- 1 cancelado no mesmo mês (não conta; insert livre mesmo com bucket cheio).
insert into public.appointments
  (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
values (
  '55555555-5555-4555-8555-555555555555',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    + interval '10 days',
  (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    + interval '10 days 30 minutes',
  0, 'cancelado'
);

-- Charge paga Pro num tenant Individual = divergência de reconciliação.
insert into public.subscription_charges
  (tenant_id, status, amount_cents, plan, paid_at)
values (
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'pago', 25900, 'pro', now()
);

-- C1 (catálogo): view é security_invoker.
select ok(
  (select 'security_invoker=true' = any(c.reloptions)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'v_charges_pagas_sem_plano'),
  'C1: v_charges_pagas_sem_plano com security_invoker=true'
);

-- C1 (catálogo): anon/authenticated sem SELECT na view.
select ok(
  not has_table_privilege('anon', 'public.v_charges_pagas_sem_plano', 'SELECT')
  and not has_table_privilege('authenticated', 'public.v_charges_pagas_sem_plano', 'SELECT'),
  'C1: anon e authenticated sem SELECT na view de reconciliação'
);

-- C2 (catálogo): authenticated sem EXECUTE no helper interno...
select ok(
  not has_function_privilege('authenticated', 'public.tenant_plan_usage(uuid)', 'EXECUTE'),
  'C2: authenticated sem EXECUTE em tenant_plan_usage'
);

-- ...mas com EXECUTE no wrapper (o guard interno nega não-super_admin).
select ok(
  has_function_privilege('authenticated', 'public.admin_get_plan_divergences()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_get_tenant_plan(uuid)', 'EXECUTE'),
  'C1/C2: authenticated com EXECUTE só nos wrappers com guard'
);

-- C1 (comportamento): admin A não lê a view direto.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$select * from public.v_charges_pagas_sem_plano$$,
  '42501', 'permission denied for view v_charges_pagas_sem_plano',
  'C1: admin do tenant não lê a view direto (revogada)'
);
reset role;
select tests.clear_authentication();

-- C1 (comportamento): admin A chama o RPC e cai no guard interno.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$select * from public.admin_get_plan_divergences()$$,
  '42501', 'forbidden',
  'C1: admin do tenant negado no RPC de divergências (guard super_admin)'
);
reset role;
select tests.clear_authentication();

-- C2 (comportamento): admin A chama o helper interno direto e é negado.
select tests.authenticate_as('51515151-5151-4515-8515-515151515151', 'authenticated');
select throws_ok(
  $$select * from public.tenant_plan_usage('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1')$$,
  '42501', 'permission denied for function tenant_plan_usage',
  'C2: admin do tenant sem EXECUTE direto em tenant_plan_usage'
);
reset role;
select tests.clear_authentication();

-- C1 (super_admin): divergência visível pelo RPC.
select tests.authenticate_as('54545454-5454-4545-8545-545454545454', 'authenticated');
select is(
  (select count(*)::int from public.admin_get_plan_divergences()),
  1,
  'C1: super_admin enxerga 1 divergência pelo RPC'
);
select is(
  (select charge_plan from public.admin_get_plan_divergences()),
  'pro',
  'C1: divergência mostra charge Pro contra tenant Individual'
);

-- C2 (regressão): wrapper de uso continua vivo para super_admin.
select is(
  (select active_professionals from public.admin_get_tenant_plan('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1')),
  1,
  'C2: admin_get_tenant_plan (único caminho) conta 1 profissional ativo'
);
reset role;
select tests.clear_authentication();

-- C3 (profissionais): reativar o 2º com teto 1 nega PLAN_LIMIT.
select throws_ok(
  $$update public.professionals set active = true
     where id = '22222222-2222-4222-8222-222222222222'$$,
  '23514', 'PLAN_LIMIT: Limite do plano individual: máximo 1 profissional(is) ativo(s).',
  'C3: reativar 2º profissional no Individual nega PLAN_LIMIT'
);

-- C3 (profissionais): update fora da coluna active não dispara e preserva.
select lives_ok(
  $$update public.professionals set name = 'Paulo Renomeado'
     where id = '11111111-1111-4111-8111-111111111111'$$,
  'C3: update de nome não dispara o trigger de limite'
);
select is(
  (select active from public.professionals where id = '11111111-1111-4111-8111-111111111111'),
  true,
  'C3: profissional segue ativo após update de nome'
);

-- C3 (appointments, regressão INSERT): 151º confirmado nega.
select throws_ok(
  $$insert into public.appointments
      (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status)
    values (
      'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
        + interval '20 days',
      (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
        + interval '20 days 30 minutes',
      0, 'confirmado')$$,
  '23514', 'PLAN_LIMIT: Limite do plano individual: máximo 150 agendamentos por mês.',
  'C3: 151º appointment confirmado no Individual nega PLAN_LIMIT (INSERT intacto)'
);

-- C3 (appointments): tirar de cancelado com bucket cheio nega.
select throws_ok(
  $$update public.appointments set status = 'confirmado'
     where id = '55555555-5555-4555-8555-555555555555'$$,
  '23514', 'PLAN_LIMIT: Limite do plano individual: máximo 150 agendamentos por mês.',
  'C3: sair de cancelado com mês cheio nega PLAN_LIMIT'
);

-- C3 (appointments): cancelar continua livre.
select lives_ok(
  $$update public.appointments set status = 'cancelado'
     where id in (select id from public.appointments
                   where tenant_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
                     and status = 'confirmado' limit 1)$$,
  'C3: cancelar appointment com bucket cheio é livre'
);

-- C3 (appointments): mudar para o mês seguinte é livre (bucket novo vazio).
select lives_ok(
  $$update public.appointments set
       starts_at = starts_at + interval '40 days',
       ends_at = ends_at + interval '40 days'
     where id in (select id from public.appointments
                   where tenant_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
                     and status = 'confirmado' limit 1)$$,
  'C3: mover appointment para mês vazio é livre'
);

select * from finish();
rollback;
