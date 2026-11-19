-- Teste de membership (ADR-04 Fase 5), pgTAP.
-- Prova: adesão cria subscription ativa + 1 pendente no ciclo; 2ª cobrança mesmo
-- ciclo volta a mesma linha; webhook pago → ativa sem duplicar (replay idempotente);
-- vencida → mark_overdue marca inadimplente + fila WhatsApp só com opt-in;
-- RLS admin-only (recepção/profissional sem leitura, cross-tenant nega); escrita
-- direta negada; ledger appointment_payments intocado.
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Roda numa transação e dá
-- rollback: nada persiste.

create extension if not exists pgtap with schema extensions;
begin;
select plan(40);

-- Helper local: executa o statement e devolve o SQLSTATE do erro, ou 'ok'.
create or replace function pg_temp.mship_try(stmt text)
returns text
language plpgsql
as $$
declare
  v_state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end;
$$;

-- ----------------------------------------------------------------------------
-- Fixture (owner): tenant A (admin/recepção/profissional) + tenant B (admin);
-- 2 clientes (opt-in true/false), 1 plano mensal ativo.
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000011', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-000000000012', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-000000000013', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-000000000011', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');

insert into customers (id, tenant_id, name, phone, whatsapp_opt_in) values
  ('a3333333-3333-4333-8333-333333333311', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Optin', '+5511900000011', true),
  ('a3333333-3333-4333-8333-333333333312', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Sem Optin', '+5511900000012', false);

insert into membership_plans (id, tenant_id, name, amount_cents, billing_period, active) values
  ('a5555555-5555-4555-8555-555555555551', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mensal Essencial', 9900, 'mensal', true);

-- ----------------------------------------------------------------------------
-- Estrutura.
-- ----------------------------------------------------------------------------
select has_table('membership_plans', 'tabela membership_plans existe');
select has_table('membership_subscriptions', 'tabela membership_subscriptions existe');
select has_table('membership_charges', 'tabela membership_charges existe');
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'membership_plans'),
  'RLS ativa em membership_plans'
);
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'membership_subscriptions'),
  'RLS ativa em membership_subscriptions'
);
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'membership_charges'),
  'RLS ativa em membership_charges'
);
select has_index('public', 'membership_subscriptions', 'membership_subscriptions_customer_plan_uidx', 'unique parcial 1 ativa/inadimplente por (customer, plan)');
select has_index('public', 'membership_charges', 'membership_charges_cycle_uidx', 'unique parcial 1 linha por (subscription, ciclo)');
select has_index('public', 'membership_charges', 'membership_charges_asaas_uidx', 'dedupe por asaas_payment_id');

-- ----------------------------------------------------------------------------
-- Adesão (admin): subscription ativa + 1 pendente no ciclo; idempotente.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');

select lives_ok(
  $$ select membership_subscribe('a3333333-3333-4333-8333-333333333311', 'a5555555-5555-4555-8555-555555555551', '2030-01') $$,
  'admin adere cliente ao plano'
);

select is(
  (select status from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333311'),
  'ativa', 'adesao nasce ativa'
);
select is(
  (select count(*) from membership_charges c
    join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id
   where s.customer_id = 'a3333333-3333-4333-8333-333333333311' and c.cycle_ref = '2030-01' and c.status = 'pendente'),
  1::bigint, 'adesao cria 1 pendente no ciclo'
);
select is(
  (select membership_charge_cycle(s.id, '2030-01') from membership_subscriptions s where s.customer_id = 'a3333333-3333-4333-8333-333333333311'),
  (select c.id from membership_charges c
    join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id
   where s.customer_id = 'a3333333-3333-4333-8333-333333333311' and c.cycle_ref = '2030-01'),
  '2a cobranca mesmo ciclo volta a mesma linha'
);
select is(
  (select membership_subscribe('a3333333-3333-4333-8333-333333333311', 'a5555555-5555-4555-8555-555555555551', '2030-01')),
  (select id from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333311'),
  're-adesao volta a subscription existente'
);
select is(
  (select count(*) from membership_charges c
    join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id
   where s.customer_id = 'a3333333-3333-4333-8333-333333333311'),
  1::bigint, 're-adesao nao duplica cobranca'
);

-- Recepção não adere (admin-only, PRD §4).
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000012', 'authenticated');
select is(
  pg_temp.mship_try($$ select membership_subscribe('a3333333-3333-4333-8333-333333333311', 'a5555555-5555-4555-8555-555555555551', '2030-02') $$),
  'PT403', 'recepcao nao adere (FORBIDDEN)'
);

-- ----------------------------------------------------------------------------
-- RLS: recepção/profissional sem leitura; cross-tenant nega; sem write direto.
-- ----------------------------------------------------------------------------
select is(
  (select count(*) from membership_plans),
  0::bigint, 'recepcao nao le planos'
);
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000013', 'authenticated');
select is(
  (select count(*) from membership_subscriptions),
  0::bigint, 'profissional nao le adesoes'
);
select is(
  (select count(*) from membership_charges),
  0::bigint, 'profissional nao le cobrancas'
);
reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000011', 'authenticated');
select is(
  (select count(*) from membership_plans),
  0::bigint, 'tenant B nao ve planos do tenant A'
);
select is(
  pg_temp.mship_try($$ insert into membership_charges (tenant_id, subscription_id, cycle_ref, amount_cents) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-4000-8000-000000000000', '2030-01', 9900) $$),
  '42501', 'escrita direta de cobranca negada (só via RPC)'
);

-- ----------------------------------------------------------------------------
-- Inadimplência: vence → mark_overdue → inadimplente + fila só com opt-in.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');
select lives_ok(
  $$ select membership_subscribe('a3333333-3333-4333-8333-333333333312', 'a5555555-5555-4555-8555-555555555551', '2030-01') $$,
  'admin adere cliente sem opt-in'
);
reset role;
-- Vence as duas pendentes do ciclo (owner, fora da RLS de leitura).
update public.membership_charges set due_at = now() - interval '1 day' where cycle_ref = '2030-01';

select lives_ok(
  $$ select membership_mark_overdue() $$,
  'mark_overdue executa'
);
select is(
  (select (membership_mark_overdue()->>'queued')::int),
  0, '2a rodada sem fila duplicada (dedupe por dedupe_key)'
);
select is(
  (select count(*) from membership_subscriptions where status = 'inadimplente'),
  2::bigint, 'vencidas marcam subscriptions inadimplente'
);
select is(
  (select count(*) from messages where dedupe_key like 'membership-charge-%' and status = 'fila'),
  1::bigint, 'fila WhatsApp só com opt-in (sem opt-in → sem mensagem)'
);

-- ----------------------------------------------------------------------------
-- Webhook pago → volta a ativa; replay sem duplicar.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ select membership_settle_charge(
    (select c.id from membership_charges c
      join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id
     where s.customer_id = 'a3333333-3333-4333-8333-333333333311' and c.cycle_ref = '2030-01'),
    'pay_test_001', 'evt_test_001') $$,
  'webhook liquida cobranca'
);
select is(
  (select status from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333311'),
  'ativa', 'pago volta subscription a ativa'
);
select is(
  (select (membership_settle_charge(c.id, 'pay_test_001', 'evt_test_001')->>'replayed')::boolean
     from membership_charges c
     join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id
    where s.customer_id = 'a3333333-3333-4333-8333-333333333311' and c.cycle_ref = '2030-01'),
  true, 'replay do webhook volta replayed sem duplicar'
);
select is(
  (select count(*) from membership_charges c
    join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id
   where s.customer_id = 'a3333333-3333-4333-8333-333333333311'),
  1::bigint, 'replay nao cria segunda linha'
);

-- ----------------------------------------------------------------------------
-- Pausar/retomar/cancelar (admin); cancelada é terminal; ledger intocado.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');
select is(
  (select membership_update_status(s.id, 'pausada')->>'status' from membership_subscriptions s where s.customer_id = 'a3333333-3333-4333-8333-333333333311'),
  'pausada', 'admin pausa'
);
select is(
  pg_temp.mship_try($$ select membership_update_status((select id from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333311'), 'cancelada') $$),
  'PT400', 'cancelar sem motivo é rejeitado'
);

-- ----------------------------------------------------------------------------
-- Regressão (review): transições ilegais, RPCs privilegiados, terminalidade.
-- ----------------------------------------------------------------------------
select is(
  pg_temp.mship_try($$ select membership_update_status((select id from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333312'), 'ativa') $$),
  'PT409', 'inadimplente nao volta a ativa via update_status (só via settle)'
);
select is(
  pg_temp.mship_try($$ select membership_update_status((select id from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333312'), 'pausada') $$),
  'PT409', 'inadimplente nao pausa via update_status (só via settle)'
);
select is(
  pg_temp.mship_try($$ select membership_settle_charge((select c.id from membership_charges c join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id where s.customer_id = 'a3333333-3333-4333-8333-333333333312' and c.cycle_ref = '2030-01'), 'pay_test_002', 'evt_test_002') $$),
  '42501', 'settle como authenticated é negado (só service_role)'
);
select is(
  pg_temp.mship_try($$ select membership_mark_overdue() $$),
  '42501', 'mark_overdue como authenticated é negado (só service_role)'
);

-- Cancela a adesão do cliente com opt-in (setup sem contar no plano).
select membership_update_status(
  (select id from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333311'),
  'cancelada', 'regressao: encerramento');

reset role;
select is(
  pg_temp.mship_try($$ select membership_settle_charge((select c.id from membership_charges c join membership_subscriptions s on s.tenant_id = c.tenant_id and s.id = c.subscription_id where s.customer_id = 'a3333333-3333-4333-8333-333333333312' and c.cycle_ref = '2030-01'), 'pay_test_001', 'evt_test_003') $$),
  'PT409', 'settle cross-charge com mesmo asaas_payment_id conflita'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');
select is(
  pg_temp.mship_try($$ select membership_update_status((select id from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333311'), 'ativa') $$),
  'PT409', 'cancelada é terminal (update rejeitado)'
);
select is(
  pg_temp.mship_try($$ select membership_charge_cycle((select id from membership_subscriptions where customer_id = 'a3333333-3333-4333-8333-333333333311'), '2030-02') $$),
  'PT409', 'charge em cancelada é rejeitado'
);

reset role;
select is(
  (select count(*) from public.appointment_payments),
  0::bigint, 'ledger appointment_payments intocado (receita membership fora do ledger)'
);

select * from finish();
