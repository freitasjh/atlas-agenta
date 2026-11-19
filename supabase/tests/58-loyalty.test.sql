-- Teste da fidelidade (ADR-06 Fase 4), pgTAP.
-- Prova: estrutura + RLS, config RBAC (admin escreve), crédito na conclusão
-- via trigger (idempotente, replay não duplica), extrato (loyalty_balance),
-- estorno em cancelamento (lógico, sem DELETE), expiração (sweep),
-- programa inativo não credita, gating por entitlement `fidelidade`,
-- isolamento cross-tenant, escopo do professional, append-only.
--
-- Nota de domínio: `concluido` é terminal (máquina de estados), logo o estorno
-- real (crédito + cancelado no mesmo atendimento) não ocorre no fluxo normal —
-- o trigger de cancelado retorna no_credit sem quebrar o UPDATE; a matemática
-- do estorno é provada com crédito inserido pelo owner + RPC de void.
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Transação + rollback.

create extension if not exists pgtap with schema extensions;
begin;
select plan(62);

-- ----------------------------------------------------------------------------
-- Fixture (owner): 2 tenants; admin/recepção/professional no A; admin no B.
-- Tenant A em enterprise (tem `fidelidade`); B em starter (sem).
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
  ('a3333333-3333-4333-8333-333333333332', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A2', '+5511900000002', false),
  ('b3333333-3333-4333-8333-333333333331', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cliente B1', '+5511900000003', true);

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Corte', 60, 8000),
  ('b2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Corte B', 60, 5000);

-- ----------------------------------------------------------------------------
-- A. Estrutura.
-- ----------------------------------------------------------------------------
select has_table('loyalty_programs', 'tabela loyalty_programs existe');
select has_table('loyalty_accounts', 'tabela loyalty_accounts existe');
select has_table('loyalty_transactions', 'tabela loyalty_transactions existe');
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'loyalty_programs'),
  'RLS ativa em loyalty_programs'
);
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'loyalty_accounts'),
  'RLS ativa em loyalty_accounts'
);
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'loyalty_transactions'),
  'RLS ativa em loyalty_transactions'
);

-- ----------------------------------------------------------------------------
-- B. Config: admin escreve; recepção/profissional só leem.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $$ insert into loyalty_programs (tenant_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  'admin cria programa do tenant (defaults: 1pt/real, floor, sem expiracao)'
);
select is(
  (select active from loyalty_programs where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  true, 'programa nasce ativo'
);
select throws_ok(
  $$ insert into loyalty_programs (tenant_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '23505', 'duplicate key value violates unique constraint "loyalty_programs_pkey"',
  'segundo programa do tenant viola pk (1 por tenant)'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');
select throws_ok(
  $$ insert into loyalty_programs (tenant_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  '42501', 'new row violates row-level security policy for table "loyalty_programs"',
  'recepcao nao escreve programa (RLS)'
);
select is(
  (select count(*) from loyalty_programs),
  1::bigint, 'recepcao le programa do tenant'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select is(
  (select count(*) from loyalty_programs),
  1::bigint, 'profissional le programa do tenant (PDV)'
);

-- ----------------------------------------------------------------------------
-- C. Crédito na conclusão via trigger (R$ 80 x 1pt/real floor = 80).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $$ insert into appointments (id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
     ('a4444444-4444-4444-8444-444444444441', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 8000, 'pendente') $$,
  'admin cria atendimento A1'
);
select lives_ok(
  $$ update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444441' $$,
  'A1 entra em atendimento (sem credito)'
);
select is(
  (select count(*) from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444441'),
  0::bigint, 'sem credito antes da conclusao'
);
select lives_ok(
  $$ update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444441' $$,
  'A1 concluido (trigger credita)'
);
select is(
  (select balance_points from loyalty_accounts where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id = 'a3333333-3333-4333-8333-333333333331'),
  80, 'saldo 80 apos conclusao de R$ 80'
);
select is(
  (select count(*) from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444441' and type = 'credit'),
  1::bigint, 'um credito para A1'
);
select ok(
  (select expires_at is null from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444441' and type = 'credit'),
  'sem expiry_days: credito sem expiracao'
);

-- ----------------------------------------------------------------------------
-- D. Idempotência: replay não duplica.
-- ----------------------------------------------------------------------------
select is(
  (select (loyalty_accrue_on_conclude('a4444444-4444-4444-8444-444444444441')->>'replayed')::boolean),
  true, 'replay de conclusao sinaliza replayed=true'
);
select is(
  (select balance_points from loyalty_accounts where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id = 'a3333333-3333-4333-8333-333333333331'),
  80, 'replay nao altera saldo'
);
select lives_ok(
  $$ update appointments set confirmed_at = now() where id = 'a4444444-4444-4444-8444-444444444441' $$,
  'update sem troca de status nao recredita'
);
select is(
  (select balance_points from loyalty_accounts where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id = 'a3333333-3333-4333-8333-333333333331'),
  80, 'saldo segue 80'
);

-- ----------------------------------------------------------------------------
-- E. Extrato (RF-18).
-- ----------------------------------------------------------------------------
select is(
  (select (loyalty_balance('a3333333-3333-4333-8333-333333333331')->>'balance_points')::int),
  80, 'loyalty_balance retorna saldo 80'
);
select is(
  (select (loyalty_balance('a3333333-3333-4333-8333-333333333331')->>'lifetime_points')::int),
  80, 'loyalty_balance retorna lifetime 80'
);

-- ----------------------------------------------------------------------------
-- F. Segundo atendimento acumula.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into appointments (id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
     ('a4444444-4444-4444-8444-444444444442', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-02 10:00:00+00', '2030-05-02 11:00:00+00', 8000, 'pendente') $$,
  'admin cria atendimento A2'
);
select lives_ok(
  $$ update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444442' $$,
  'A2 em atendimento'
);
select lives_ok(
  $$ update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444442' $$,
  'A2 concluido (trigger credita)'
);
select is(
  (select balance_points from loyalty_accounts where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id = 'a3333333-3333-4333-8333-333333333331'),
  160, 'saldo acumula 160 apos dois atendimentos'
);

-- ----------------------------------------------------------------------------
-- G. Cancelado sem credito: trigger passa sem quebrar o UPDATE.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into appointments (id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
     ('a4444444-4444-4444-8444-444444444443', 'a3333333-3333-4333-8333-333333333332', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-03 10:00:00+00', '2030-05-03 11:00:00+00', 8000, 'pendente') $$,
  'admin cria atendimento A3'
);
select lives_ok(
  $$ update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444443' $$,
  'A3 em atendimento'
);
select lives_ok(
  $$ update appointments set status = 'cancelado' where id = 'a4444444-4444-4444-8444-444444444443' $$,
  'A3 cancelado (trigger de estorno sem credito nao quebra)'
);
select is(
  (select count(*) from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444443'),
  0::bigint, 'cancelado sem credito gera zero linhas'
);

-- ----------------------------------------------------------------------------
-- H. Estorno com credito (lógico: carimba void + linha `void`, sem DELETE).
-- ----------------------------------------------------------------------------
reset role;
-- Conta de C2 ainda não existe (A3 cancelou antes de concluir): cria + crédito
-- manual pelo owner para provar a matemática do estorno.
insert into loyalty_accounts (tenant_id, customer_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332');
insert into loyalty_transactions (tenant_id, account_id, appointment_id, type, points, reason)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', la.id, 'a4444444-4444-4444-8444-444444444443', 'credit', 80, 'setup de teste'
  from loyalty_accounts la
 where la.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and la.customer_id = 'a3333333-3333-4333-8333-333333333332';
update loyalty_accounts
   set balance_points = balance_points + 80, lifetime_points = lifetime_points + 80
 where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and customer_id = 'a3333333-3333-4333-8333-333333333332';

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  (select (loyalty_void_for_cancelled_appointment('a4444444-4444-4444-8444-444444444443')->>'voided')::boolean),
  true, 'estorno de A3 executa'
);
select is(
  (select balance_points from loyalty_accounts where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id = 'a3333333-3333-4333-8333-333333333332'),
  0, 'saldo zerado apos estorno'
);
select is(
  (select (loyalty_void_for_cancelled_appointment('a4444444-4444-4444-8444-444444444443')->>'replayed')::boolean),
  true, 'replay de estorno sinaliza replayed=true'
);
select ok(
  (select voided_at is not null from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444443' and type = 'credit'),
  'credito original carimbado com voided_at (estorno logico)'
);

-- ----------------------------------------------------------------------------
-- I. Expiração (sweep).
-- ----------------------------------------------------------------------------
reset role;
update loyalty_transactions set expires_at = now() - interval '1 day'
 where appointment_id = 'a4444444-4444-4444-8444-444444444442' and type = 'credit';

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select cmp_ok(
  (select loyalty_expire_sweep(100)),
  '>=', 1, 'sweep expira credito vencido de A2'
);
select is(
  (select count(*) from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444442' and type = 'expire'),
  1::bigint, 'linha expire registrada para A2'
);
select is(
  (select balance_points from loyalty_accounts where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id = 'a3333333-3333-4333-8333-333333333331'),
  80, 'saldo cai para 80 apos expirar 80 de A2'
);
select is(
  (select loyalty_expire_sweep(100)),
  0, 'segundo sweep nao reexpira (idempotente)'
);

-- ----------------------------------------------------------------------------
-- J. Programa inativo não credita.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ update loyalty_programs set active = false where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'admin desativa programa'
);
select lives_ok(
  $$ insert into appointments (id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
     ('a4444444-4444-4444-8444-444444444444', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-04 10:00:00+00', '2030-05-04 11:00:00+00', 8000, 'pendente') $$,
  'admin cria atendimento A4'
);
select lives_ok(
  $$ update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444444' $$,
  'A4 em atendimento'
);
select lives_ok(
  $$ update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444444' $$,
  'A4 concluido sem programa ativo (trigger pula, UPDATE ok)'
);
select is(
  (select balance_points from loyalty_accounts where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and customer_id = 'a3333333-3333-4333-8333-333333333331'),
  80, 'saldo segue 80 sem programa ativo'
);
select lives_ok(
  $$ update loyalty_programs set active = true where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'admin reativa programa'
);

-- ----------------------------------------------------------------------------
-- K. Gating por entitlement (tenant B starter, sem `fidelidade`).
-- ----------------------------------------------------------------------------
reset role;
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('b4444444-4444-4444-8444-444444444441', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b3333333-3333-4333-8333-333333333331', 'b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 5000, 'em_atendimento');

reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001', 'authenticated');
select lives_ok(
  $$ update appointments set status = 'concluido' where id = 'b4444444-4444-4444-8444-444444444441' $$,
  'concluir sem entitlement nao quebra o atendimento (trigger pula)'
);
select throws_ok(
  $$ select loyalty_accrue_on_conclude('b4444444-4444-4444-8444-444444444441') $$,
  'PT403', 'FEATURE_DISABLED',
  'credito sem entitlement nega com FEATURE_DISABLED'
);
select throws_ok(
  $$ select loyalty_balance('b3333333-3333-4333-8333-333333333331') $$,
  'PT403', 'FEATURE_DISABLED',
  'extrato sem entitlement nega com FEATURE_DISABLED'
);

-- ----------------------------------------------------------------------------
-- L. Isolamento cross-tenant + escopo do professional.
-- ----------------------------------------------------------------------------
select is(
  (select count(*) from loyalty_accounts),
  0::bigint, 'tenant B nao enxerga contas do tenant A'
);
select is(
  (select count(*) from loyalty_transactions),
  0::bigint, 'tenant B nao enxerga transacoes do tenant A'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select cmp_ok(
  (select count(*) from loyalty_accounts),
  '>=', 2::bigint, 'profissional enxerga contas de clientes da propria agenda'
);
select cmp_ok(
  (select count(*) from loyalty_transactions),
  '>=', 3::bigint, 'profissional enxerga transacoes da propria agenda'
);

reset role;
insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Sem Agenda', '+5511900000009');
insert into loyalty_accounts (tenant_id, customer_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333333');

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select is(
  (select count(*) from loyalty_accounts where customer_id = 'a3333333-3333-4333-8333-333333333333'),
  0::bigint, 'profissional nao enxerga conta de cliente fora da propria agenda'
);

-- ----------------------------------------------------------------------------
-- M. Append-only + sem escrita direta.
-- Nota de mecânica RLS (medida no banco local): UPDATE/DELETE sem policy p/
-- authenticated pula as linhas em silêncio (0 rows, sem erro) — o trigger de
-- imutabilidade é a rede para vias privilegiadas (owner/service_role/definer),
-- por isso é provado como owner; a negação ao cliente é provada pelo 0-rows.
-- ----------------------------------------------------------------------------
reset role;
select throws_ok(
  $$ update loyalty_transactions set points = 9999 where appointment_id = 'a4444444-4444-4444-8444-444444444441' and type = 'credit' $$,
  'PT403', 'LOYALTY_TRANSACTION_IMMUTABLE',
  'update de points barrado pelo trigger (append-only)'
);
select throws_ok(
  $$ delete from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444441' and type = 'credit' $$,
  'PT403', 'HARD_DELETE_FORBIDDEN',
  'delete de transacao barrado pelo trigger'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select lives_ok(
  $$ update loyalty_transactions set points = 9999 where appointment_id = 'a4444444-4444-4444-8444-444444444441' and type = 'credit' $$,
  'update direto como admin nao quebra (RLS pula em silencio)'
);
select is(
  (select points from loyalty_transactions where appointment_id = 'a4444444-4444-4444-8444-444444444441' and type = 'credit'),
  80, 'update direto como admin nao altera points (0 rows)'
);
select throws_ok(
  $$ delete from loyalty_programs where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'PT403', 'HARD_DELETE_FORBIDDEN',
  'delete de programa barrado'
);
select throws_ok(
  $$ insert into loyalty_accounts (tenant_id, customer_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333332') $$,
  '42501', 'new row violates row-level security policy for table "loyalty_accounts"',
  'insert direto em conta negado (só via RPC)'
);
select throws_ok(
  $$ insert into loyalty_transactions (tenant_id, account_id, type, points) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from loyalty_accounts limit 1), 'credit', 10) $$,
  '42501', 'new row violates row-level security policy for table "loyalty_transactions"',
  'insert direto em transacao negado (só via RPC)'
);

select * from finish();
rollback;
