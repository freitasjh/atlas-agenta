-- Teste de cupons e gift cards (ADR-07 Fase 4), pgTAP.
-- Prova: estrutura + RLS, RBAC de emissão (admin escreve), validação
-- (código/validade/limite/segmento), aplicação no fechamento (Q1: cupom reduz
-- total antes do ledger; summary coupon-aware), gift card como forma `gift_card`
-- no ledger (Q2: receita no resgate, sem dupla contagem), saldo parcial,
-- idempotência por chave, expiração (sweep), teto do register contra total
-- final, gating por entitlement `fidelidade`, isolamento cross-tenant.
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Transação + rollback.

create extension if not exists pgtap with schema extensions;
begin;
select plan(61);

-- ----------------------------------------------------------------------------
-- Fixture (owner): 2 tenants; admin/recepção/professional no A; admin no B.
-- Tenant A em enterprise (tem `fidelidade`); B em plano default (sem).
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');

update tenants set plan = 'enterprise' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into professionals (id, tenant_id, name, profile_id) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A', 'a0000000-0000-4000-8000-000000000003'),
  ('b1111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Profissional B', null);

insert into customers (id, tenant_id, name, phone, whatsapp_opt_in) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A1', '+5511900000001', true),
  ('b3333333-3333-4333-8333-333333333331', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cliente B1', '+5511900000003', true);

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Corte', 60, 8000),
  ('b2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Corte B', 60, 5000);

insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444441', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 8000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444442', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-02 10:00:00+00', '2030-05-02 11:00:00+00', 8000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444443', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-03 10:00:00+00', '2030-05-03 11:00:00+00', 8000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-04 10:00:00+00', '2030-05-04 11:00:00+00', 2000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444445', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-05 10:00:00+00', '2030-05-05 11:00:00+00', 2000, 'pendente');
update appointments set status = 'em_atendimento'
 where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('b4444444-4444-4444-8444-444444444441', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331', 'b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 5000, 'em_atendimento');

-- Cupons/gift cards de apoio (owner; emissão por admin é provada na seção B).
insert into coupons (tenant_id, code, type, value) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'INAT', 'percent', 5);
update coupons set active = false where code = 'INAT';
insert into coupons (tenant_id, code, type, value, valid_until) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'EXP', 'percent', 5, now() - interval '1 day');
insert into coupons (tenant_id, code, type, value, valid_from) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FUTURE', 'percent', 5, now() + interval '1 day');
insert into coupons (tenant_id, code, type, value, usage_limit) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'LIM1', 'percent', 5, 1);
insert into coupons (tenant_id, code, type, value, segment) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEG', 'percent', 5, '{"service_ids": ["00000000-0000-4000-8000-000000000000"]}');
insert into coupons (tenant_id, code, type, value) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CUPOM2', 'fixed', 100),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PROF10', 'percent', 10);
insert into gift_cards (tenant_id, code, initial_value_cents, balance_cents) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GC-2', 2000, 2000);
insert into gift_cards (tenant_id, code, initial_value_cents, balance_cents, valid_until) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GC-EXP', 5000, 5000, now() - interval '1 day');

-- ----------------------------------------------------------------------------
-- A. Estrutura.
-- ----------------------------------------------------------------------------
select has_table('coupons', 'tabela coupons existe');
select has_table('gift_cards', 'tabela gift_cards existe');
select has_table('coupon_redemptions', 'tabela coupon_redemptions existe');
select has_table('gift_card_redemptions', 'tabela gift_card_redemptions existe');
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'coupons'),
  'RLS ativa em coupons'
);
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'gift_cards'),
  'RLS ativa em gift_cards'
);
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'coupon_redemptions'),
  'RLS ativa em coupon_redemptions'
);
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'gift_card_redemptions'),
  'RLS ativa em gift_card_redemptions'
);

-- ----------------------------------------------------------------------------
-- B. Emissão: admin escreve; recepção só lê (PDV valida).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $$ insert into coupons (tenant_id, code, type, value) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CUPOM10', 'percent', 10) $$,
  'admin emite cupom 10%'
);
select throws_ok(
  $$ insert into coupons (tenant_id, code, type, value) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CUPOM10', 'percent', 10) $$,
  '23505', 'duplicate key value violates unique constraint "coupons_tenant_code_unique"',
  'código duplicado no tenant viola unique'
);
select is(
  (select count(*) from coupons),
  8::bigint, 'admin enxerga os 8 cupons do tenant'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');
select throws_ok(
  $$ insert into coupons (tenant_id, code, type, value) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'X', 'percent', 5) $$,
  '42501', 'new row violates row-level security policy for table "coupons"',
  'recepcao nao emite cupom (RLS)'
);
select is(
  (select count(*) from coupons),
  8::bigint, 'recepcao le cupons do tenant (PDV valida)'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select is(
  (select count(*) from coupons),
  8::bigint, 'profissional le cupons do tenant (PDV)'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select lives_ok(
  $$ insert into gift_cards (tenant_id, code, initial_value_cents, balance_cents) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GC-100', 10000, 10000) $$,
  'admin emite gift card de R$ 100'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');
select throws_ok(
  $$ insert into gift_cards (tenant_id, code, initial_value_cents, balance_cents) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GC-X', 1000, 1000) $$,
  '42501', 'new row violates row-level security policy for table "gift_cards"',
  'recepcao nao emite gift card (RLS)'
);

-- ----------------------------------------------------------------------------
-- C. Validação de cupom (somente leitura).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444441', 'CUPOM10')->>'valid')::boolean),
  true, 'CUPOM10 válido para A1'
);
select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444441', 'CUPOM10')->>'discount_cents')::int),
  800, 'CUPOM10 em R$ 80 = R$ 8 de desconto (floor)'
);
select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444441', 'NOPE')->>'reason')),
  'COUPON_NOT_FOUND', 'código desconhecido rejeitado'
);
select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444441', 'INAT')->>'reason')),
  'COUPON_INACTIVE', 'cupom inativo rejeitado'
);
select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444441', 'EXP')->>'reason')),
  'COUPON_EXPIRED', 'cupom expirado rejeitado'
);
select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444441', 'FUTURE')->>'reason')),
  'COUPON_NOT_STARTED', 'cupom fora da janela inicial rejeitado'
);
select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444441', 'SEG')->>'reason')),
  'COUPON_SEGMENT_MISMATCH', 'cupom fora do segmento rejeitado'
);
select lives_ok(
  $$ select apply_coupon_to_closing('a4444444-4444-4444-8444-444444444442', 'LIM1', 'c0000000-0000-4000-8000-000000000001') $$,
  'LIM1 aplicado em A2 (consome a única unidade)'
);
select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444443', 'LIM1')->>'reason')),
  'COUPON_LIMIT_REACHED', 'limite de uso esgotado rejeitado'
);

-- ----------------------------------------------------------------------------
-- D. Aplicação no fechamento (Q1: reduz total antes do ledger).
-- ----------------------------------------------------------------------------
select is(
  (select (apply_coupon_to_closing('a4444444-4444-4444-8444-444444444441', 'CUPOM10', 'c0000000-0000-4000-8000-000000000002')->>'applied')::boolean),
  true, 'CUPOM10 aplicado em A1'
);
select is(
  (select (apply_coupon_to_closing('a4444444-4444-4444-8444-444444444441', 'CUPOM10', 'c0000000-0000-4000-8000-000000000002')->>'replayed')::boolean),
  true, 'replay da mesma chave idempotente'
);
select is(
  (select discount_cents from coupon_redemptions where appointment_id = 'a4444444-4444-4444-8444-444444444441'),
  800, 'trilha registra desconto de 800'
);
select is(
  (select used_count from coupons where code = 'CUPOM10' and tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'uso do cupom incrementado uma vez (replay nao duplica)'
);
-- Summary é service_role-only: leitura direta roda como owner.
reset role;
select is(
  (select (appointment_payment_summary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a4444444-4444-4444-8444-444444444441')->>'discount_cents')::int),
  800, 'summary expõe discount_cents'
);
select is(
  (select (appointment_payment_summary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a4444444-4444-4444-8444-444444444441')->>'remaining_cents')::int),
  7200, 'summary calcula restante sobre o total final (7200)'
);
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select throws_ok(
  $$ select apply_coupon_to_closing('a4444444-4444-4444-8444-444444444441', 'CUPOM2', 'c0000000-0000-4000-8000-000000000003') $$,
  'PT409', 'IDEMPOTENCY_CONFLICT',
  'segundo cupom no mesmo fechamento conflita (um por atendimento)'
);

-- ----------------------------------------------------------------------------
-- E. Gift card: validação, resgate parcial, ledger `gift_card` (Q2).
-- ----------------------------------------------------------------------------
select is(
  (select (gift_card_validate('GC-100')->>'valid')::boolean),
  true, 'GC-100 válido'
);
select is(
  (select (gift_card_validate('GC-100')->>'balance_cents')::int),
  10000, 'GC-100 com saldo de 10000'
);
select is(
  (select (redeem_gift_card('a4444444-4444-4444-8444-444444444441', 'GC-100', 3000, 'c0000000-0000-4000-8000-000000000004')->>'redeemed')::boolean),
  true, 'resgate parcial de 3000 em A1'
);
select is(
  (select balance_cents from gift_cards where code = 'GC-100' and tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  7000, 'saldo do cartão cai para 7000'
);
select is(
  (select method from appointment_payments where appointment_id = 'a4444444-4444-4444-8444-444444444441' and method = 'gift_card'),
  'gift_card', 'linha gift_card no ledger (receita no resgate)'
);
select is(
  (select count(*) from gift_card_redemptions where appointment_id = 'a4444444-4444-4444-8444-444444444441'),
  1::bigint, 'trilha de resgate registrada'
);
select is(
  (select (redeem_gift_card('a4444444-4444-4444-8444-444444444441', 'GC-100', 3000, 'c0000000-0000-4000-8000-000000000004')->>'replayed')::boolean),
  true, 'replay do resgate idempotente'
);
select throws_ok(
  $$ select redeem_gift_card('a4444444-4444-4444-8444-444444444441', 'GC-100', 8000, 'c0000000-0000-4000-8000-000000000005') $$,
  'PT409', 'GIFT_CARD_INSUFFICIENT',
  'resgate acima do saldo rejeitado'
);
select throws_ok(
  $$ select redeem_gift_card('a4444444-4444-4444-8444-444444444441', 'GC-100', 5000, 'c0000000-0000-4000-8000-000000000006') $$,
  'PT409', 'AMOUNT_EXCEEDS_REMAINING',
  'resgate acima do restante do fechamento rejeitado'
);
reset role;
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'a4444444-4444-4444-8444-444444444441', '[{"method": "dinheiro", "amount_cents": 4200}]', 'c0000000-0000-4000-8000-000000000007', true) $$,
  'dinheiro cobre o restante (4200) no mesmo fechamento'
);
select is(
  (select (appointment_payment_summary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a4444444-4444-4444-8444-444444444441')->>'payment_status')),
  'quitado', 'fechamento com cupom + gift card + dinheiro quita o total final'
);
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

-- ----------------------------------------------------------------------------
-- F. Expiração (sweep) + esgotamento.
-- ----------------------------------------------------------------------------
select is(
  (select (gift_card_validate('GC-EXP')->>'reason')),
  'GIFT_CARD_EXPIRED', 'cartão vencido rejeitado na validação'
);
select cmp_ok(
  (select expire_coupons_gift_cards()),
  '>=', 1, 'sweep expira cartão vencido'
);
select is(
  (select status from gift_cards where code = 'GC-EXP' and tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'expired', 'cartão vencido carimbado como expired'
);
select is(
  (select (redeem_gift_card('a4444444-4444-4444-8444-444444444444', 'GC-2', 2000, 'c0000000-0000-4000-8000-000000000008')->>'redeemed')::boolean),
  true, 'resgate integral de GC-2 em A4'
);
select is(
  (select status from gift_cards where code = 'GC-2' and tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'exhausted', 'saldo zerado marca exhausted'
);

-- ----------------------------------------------------------------------------
-- G. Isolamento cross-tenant + gating por entitlement.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001', 'authenticated');

select is(
  (select count(*) from coupons),
  0::bigint, 'tenant B nao enxerga cupons do tenant A'
);
select is(
  (select count(*) from gift_cards),
  0::bigint, 'tenant B nao enxerga gift cards do tenant A'
);
select is(
  (select count(*) from coupon_redemptions),
  0::bigint, 'tenant B nao enxerga usos de cupom do tenant A'
);
select is(
  (select count(*) from gift_card_redemptions),
  0::bigint, 'tenant B nao enxerga resgates do tenant A'
);
select throws_ok(
  $$ select coupon_validate('b4444444-4444-4444-8444-444444444441', 'CUPOM10') $$,
  'PT403', 'FEATURE_DISABLED',
  'validação sem entitlement nega com FEATURE_DISABLED'
);

-- ----------------------------------------------------------------------------
-- H. Teto do register contra o total final (Q1).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $$ select apply_coupon_to_closing('a4444444-4444-4444-8444-444444444443', 'CUPOM10', 'c0000000-0000-4000-8000-000000000009') $$,
  'CUPOM10 aplicado em A3 (total final 7200)'
);
reset role;
select throws_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'a4444444-4444-4444-8444-444444444443', '[{"method": "dinheiro", "amount_cents": 7201}]', 'c0000000-0000-4000-8000-000000000010', true) $$,
  'PT409', 'AMOUNT_EXCEEDS_REMAINING',
  'pagamento acima do total final rejeitado'
);
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'a4444444-4444-4444-8444-444444444443', '[{"method": "dinheiro", "amount_cents": 7200}]', 'c0000000-0000-4000-8000-000000000011', true) $$,
  'pagamento igual ao total final aceito e conclui'
);
select is(
  (select (appointment_payment_summary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a4444444-4444-4444-8444-444444444443')->>'payment_status')),
  'quitado', 'total final quitado com cupom'
);

-- ----------------------------------------------------------------------------
-- I. Append-only: sem DELETE físico pela app.
-- ----------------------------------------------------------------------------
select throws_ok(
  $$ delete from coupons where code = 'CUPOM10' $$,
  'PT403', 'HARD_DELETE_FORBIDDEN',
  'delete de cupom barrado'
);
select throws_ok(
  $$ delete from gift_cards where code = 'GC-100' $$,
  'PT403', 'HARD_DELETE_FORBIDDEN',
  'delete de gift card barrado'
);

-- ----------------------------------------------------------------------------
-- J. Professional aplica cupom no próprio atendimento (PDV autorizado).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');

select is(
  (select (coupon_validate('a4444444-4444-4444-8444-444444444445', 'PROF10')->>'valid')::boolean),
  true, 'profissional valida cupom no próprio atendimento'
);
select lives_ok(
  $$ select apply_coupon_to_closing('a4444444-4444-4444-8444-444444444445', 'PROF10', 'c0000000-0000-4000-8000-000000000012') $$,
  'profissional aplica cupom no próprio atendimento'
);

select * from finish();
rollback;
