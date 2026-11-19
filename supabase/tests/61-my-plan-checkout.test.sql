-- Teste do Meu plano + checkout self-service (ADR-10 Fase 4), pgTAP.
-- Prova: catálogo (checkout_self_service nos pagos, fora do free), estrutura
-- (scheduled_plan/kind/idempotency), get_my_plan (uso vs quota, invoices só
-- admin, can_checkout, plan_state), get_my_invoices (RBAC), upgrade imediato,
-- downgrade agendado (pergunta 9 PRD), apply_due (efetiva vencido, pula com
-- uso acima do limite), next_cycle_start_utc, isolamento cross-tenant.
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Transação + rollback.

create extension if not exists pgtap with schema extensions;
begin;
select plan(44);

-- ----------------------------------------------------------------------------
-- Fixture (owner): admin/recepção/profissional no A; admin no B.
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');

update tenants set plan = 'starter', subscription_status = 'pendente', timezone = 'America/Sao_Paulo'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update tenants set plan = 'premium', subscription_status = 'ativo', timezone = 'America/Sao_Paulo'
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

insert into professionals (id, tenant_id, name) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A');
insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Corte', 60, 8000);
insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A1', '+5511900000001');
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444441', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111',
   'a2222222-2222-4222-8222-222222222222',
   date_trunc('month', now()) + interval '5 days',
   date_trunc('month', now()) + interval '5 days' + interval '1 hour',
   8000, 'pendente');

insert into subscription_charges (id, tenant_id, status, amount_cents, plan, kind, billing_period) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'pendente', 14900, 'premium', 'upgrade', 'monthly');

-- ----------------------------------------------------------------------------
-- A. Catálogo: checkout_self_service nos pagos, fora do free.
-- ----------------------------------------------------------------------------
select ok(
  (select features ? 'checkout_self_service' from plans where slug = 'starter'),
  'starter tem checkout_self_service'
);
select ok(
  (select features ? 'checkout_self_service' from plans where slug = 'premium'),
  'premium tem checkout_self_service'
);
select ok(
  (select features ? 'checkout_self_service' from plans where slug = 'enterprise'),
  'enterprise tem checkout_self_service'
);
select ok(
  not (select features ? 'checkout_self_service' from plans where slug = 'free'),
  'free nao tem checkout_self_service (RF-38: upsell)'
);

-- ----------------------------------------------------------------------------
-- B. Estrutura.
-- ----------------------------------------------------------------------------
select has_column('tenants', 'scheduled_plan', 'tenants tem scheduled_plan');
select has_column('tenants', 'scheduled_effective_at', 'tenants tem scheduled_effective_at');
select has_column('subscription_charges', 'kind', 'subscription_charges tem kind');
select has_column('subscription_charges', 'idempotency_key', 'subscription_charges tem idempotency_key');
select has_column('subscription_charges', 'effective_at', 'subscription_charges tem effective_at');
select ok(
  (select count(*)::int from pg_indexes
    where indexname = 'subscription_charges_idempotency_key_uidx') = 1,
  'indice unico parcial em idempotency_key existe'
);
select ok(
  plan_rank('free') < plan_rank('starter')
  and plan_rank('starter') < plan_rank('premium')
  and plan_rank('premium') < plan_rank('enterprise'),
  'plan_rank ordena free < starter < premium < enterprise'
);

-- ----------------------------------------------------------------------------
-- C. get_my_plan como admin (uso vs quota, fatura, estados).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  (select get_my_plan()->>'plan_slug'),
  'starter', 'admin ve plan_slug starter'
);
select is(
  ((select get_my_plan()->'usage'->>'appts')::int),
  1, 'admin ve uso 1 agendamento no mes'
);
select is(
  (select get_my_plan()->'usage'->>'month_key'),
  to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'),
  'month_key no fuso do tenant'
);
select ok(
  ((select get_my_plan()->'entitlements'->>'checkoutSelfService')::boolean),
  'admin ve entitlement checkoutSelfService'
);
select ok(
  ((select get_my_plan()->>'can_checkout')::boolean),
  'admin com entitlement pode checkout'
);
select is(
  (select get_my_plan()->>'plan_state'),
  'pending_payment', 'com cobranca pendente o estado e pending_payment'
);
select is(
  (select jsonb_array_length(get_my_plan()->'invoices')),
  1, 'admin ve 1 fatura no historico'
);

-- ----------------------------------------------------------------------------
-- D. Recepção: base legível, sem valores, sem checkout.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');
select ok(
  (select get_my_plan()->>'invoices' is null),
  'recepcao nao ve invoices'
);
select ok(
  not ((select get_my_plan()->>'can_checkout')::boolean),
  'recepcao nao pode checkout'
);
select is(
  (select get_my_plan()->>'plan_slug'),
  'starter', 'recepcao ve base do plano'
);

-- ----------------------------------------------------------------------------
-- E. Profissional: sem valores.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select ok(
  (select get_my_plan()->>'invoices' is null),
  'professional nao ve invoices'
);
select is(
  (select get_my_plan()->>'plan_state'),
  'pending_payment', 'professional ve estado sem valores'
);

-- ----------------------------------------------------------------------------
-- F. get_my_invoices: admin ok; demais negados.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  (select count(*) from get_my_invoices()),
  1::bigint, 'admin lista 1 fatura'
);
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');
select throws_ok(
  $$ select * from get_my_invoices() $$,
  'PT403', 'FORBIDDEN',
  'recepcao nao lista faturas (forbidden)'
);
reset role;
select tests.clear_authentication();
select throws_ok(
  $$ select * from get_my_invoices() $$,
  'PT403', 'FORBIDDEN',
  'sem jwt nao lista faturas (forbidden)'
);

-- ----------------------------------------------------------------------------
-- G. Upgrade: aplica imediatamente apos confirmacao (server-side, sem JWT).
-- ----------------------------------------------------------------------------
select tests.clear_authentication();
select is(
  ((select apply_subscription_payment('c0000000-0000-4000-8000-000000000001')->>'applied')::boolean),
  true, 'liquidacao do upgrade aplica'
);
select is(
  (select status from subscription_charges where id = 'c0000000-0000-4000-8000-000000000001'),
  'pago', 'cobranca marcada paga'
);
select is(
  (select plan from tenants where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'premium', 'upgrade imediato troca o plano'
);
select is(
  (select subscription_status from tenants where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'ativo', 'pagamento confirmado ativa assinatura'
);
select is(
  ((select apply_subscription_payment('c0000000-0000-4000-8000-000000000001')->>'applied')::boolean),
  false, 'replay da liquidacao e no-op (idempotente)'
);

-- ----------------------------------------------------------------------------
-- H. Downgrade: agenda para o fim do ciclo (pergunta 9 PRD).
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A2');
insert into subscription_charges (id, tenant_id, status, amount_cents, plan, kind, billing_period) values
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'pendente', 5900, 'starter', 'downgrade', 'monthly');
select is(
  ((select apply_subscription_payment('c0000000-0000-4000-8000-000000000002')->>'kind')),
  'downgrade', 'liquidacao do downgrade retorna kind'
);
select is(
  (select plan from tenants where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'premium', 'downgrade nao troca o plano na hora'
);
select ok(
  (select scheduled_plan = 'starter' and scheduled_effective_at is not null
   from tenants where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'downgrade agenda scheduled_plan com vigencia'
);
select is(
  (select apply_due_scheduled_plans()),
  0, 'nada vence antes do fim do ciclo'
);
update tenants set scheduled_effective_at = now() - interval '1 minute'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(
  (select apply_due_scheduled_plans()),
  1, 'efetiva 1 downgrade vencido'
);
select ok(
  (select plan = 'starter' and scheduled_plan is null and scheduled_effective_at is null
   from tenants where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'downgrade vencido troca o plano e limpa o agendado'
);

-- ----------------------------------------------------------------------------
-- I. apply_due pula com uso acima do limite (sem plano inconsistente).
-- ----------------------------------------------------------------------------
update tenants set plan = 'premium', scheduled_plan = 'starter',
  scheduled_effective_at = now() - interval '1 minute'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into professionals (tenant_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A2');
select is(
  (select apply_due_scheduled_plans()),
  0, 'com 2 profs no destino starter (limite 1) pula'
);
select is(
  (select count(*) from audit_log
   where action = 'scheduled_plan_skipped_over_limit'
     and tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1::bigint, 'pulo auditado sem PII'
);

-- ----------------------------------------------------------------------------
-- J. next_cycle_start_utc: dia 1 do mes seguinte.
-- ----------------------------------------------------------------------------
select is(
  (extract(day from next_cycle_start_utc('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))::int),
  1, 'vigencia cai no dia 1'
);
select is(
  (select to_char(next_cycle_start_utc('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'YYYY-MM')),
  to_char(now() + interval '1 month', 'YYYY-MM'),
  'vigencia no mes seguinte'
);

-- ----------------------------------------------------------------------------
-- K. Isolamento cross-tenant.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  (select get_my_plan()->>'plan_slug'),
  'premium', 'tenant B ve o proprio plano'
);
select is(
  (select count(*) from get_my_invoices()),
  0::bigint, 'tenant B nao ve faturas do A'
);

-- ----------------------------------------------------------------------------
-- L. Cancelado nao tem checkout.
-- ----------------------------------------------------------------------------
reset role;
select tests.clear_authentication();
update tenants set subscription_status = 'cancelado'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select ok(
  not ((select get_my_plan()->>'can_checkout')::boolean),
  'cancelado nao pode checkout'
);

select * from finish();
rollback;
