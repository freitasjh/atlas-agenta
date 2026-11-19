-- Teste do CRM profundo (ADR-08 Fase 4), pgTAP.
-- Prova: estrutura + RLS, preferencias por papel, notas por visibilidade/papel,
-- filtros (tag/segmento/no-show/opt-in), consentimento + gate de disparo,
-- RBAC financeiro (ticket medio so admin), escopo do professional, cross-tenant.
--
-- Fixture propria, dominio `.invalido` (guarda do harness). Transacao + rollback.

create extension if not exists pgtap with schema extensions;
begin;
select plan(40);

-- ----------------------------------------------------------------------------
-- Fixture (owner): 2 tenants; admin/recepcao/professional no A; admin no B.
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');

update tenants set plan = 'enterprise' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into professionals (id, tenant_id, name, profile_id) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A', 'a0000000-0000-4000-8000-000000000003'),
  ('a1111111-1111-4111-8111-111111111112', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A2', null);

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Corte', 60, 8000);

insert into customers (id, tenant_id, name, phone, whatsapp_opt_in, tags, segment) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A1', '+5511900000001', true, '{"vip","recorrente"}', 'recorrente'),
  ('a3333333-3333-4333-8333-333333333332', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A2', '+5511900000002', false, '{"novo"}', 'novo'),
  ('a3333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A3 Sem Agenda', '+5511900000009', false, '{}', null),
  ('b3333333-3333-4333-8333-333333333331', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cliente B1', '+5511900000003', true, '{"vip"}', 'recorrente');

-- Programa de fidelidade do tenant A (ficha 360 consome saldo da ADR-06).
insert into loyalty_programs (tenant_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- Atendimentos de A1: 1 concluido (prof A) + 1 no-show (prof A) + 1 pendente (prof A2).
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444441', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 8000, 'em_atendimento'),
  ('a4444444-4444-4444-8444-444444444442', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-05-02 10:00:00+00', '2030-05-02 11:00:00+00', 8000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444443', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111112', 'a2222222-2222-4222-8222-222222222222', '2030-05-03 10:00:00+00', '2030-05-03 11:00:00+00', 8000, 'pendente');
update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444441';
update appointments set status = 'nao_compareceu' where id = 'a4444444-4444-4444-8444-444444444442';

-- Pagamento manual do atendimento concluido (R$ 80) — base do ticket medio.
insert into appointment_payments (tenant_id, appointment_id, method, amount_cents, source, received_by) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a4444444-4444-4444-8444-444444444441', 'dinheiro', 8000, 'manual', 'a0000000-0000-4000-8000-000000000001');

-- ----------------------------------------------------------------------------
-- A. Estrutura.
-- ----------------------------------------------------------------------------
select has_table('customer_notes', 'tabela customer_notes existe');
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'customer_notes'),
  'RLS ativa em customer_notes'
);
select has_column('customers', 'preferred_professional_id', 'customers tem preferred_professional_id');
select has_column('customers', 'segment', 'customers tem segment');
select has_column('customers', 'tags', 'customers tem tags');
select has_column('customers', 'whatsapp_opt_in_at', 'customers tem whatsapp_opt_in_at');
select has_column('customers', 'lgpd_consent_at', 'customers tem lgpd_consent_at');

-- ----------------------------------------------------------------------------
-- B. Preferencias persistem e sao lidas por papel autorizado.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select lives_ok(
  $$ update customers set
       preferred_professional_id = 'a1111111-1111-4111-8111-111111111111',
       preferred_time_window = 'manha',
       notes_summary = 'Prefere cafe sem acucar.',
       segment = 'recorrente',
       tags = '{"vip","fiel"}'
     where id = 'a3333333-3333-4333-8333-333333333331' $$,
  'admin atualiza preferencias de A1'
);
select is(
  (select segment from customers where id = 'a3333333-3333-4333-8333-333333333331'),
  'recorrente', 'segmento lido de volta'
);
select is(
  (select tags::text from customers where id = 'a3333333-3333-4333-8333-333333333331'),
  '{vip,fiel}', 'tags lidas de volta'
);
select is(
  (select preferred_professional_id from customers where id = 'a3333333-3333-4333-8333-333333333331'),
  'a1111111-1111-4111-8111-111111111111', 'profissional preferido lido de volta'
);

-- ----------------------------------------------------------------------------
-- C. Notas respeitam visibilidade por papel.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into customer_notes (customer_id, visibility, body) values
     ('a3333333-3333-4333-8333-333333333331', 'admin', 'Nota interna da gerencia.') $$,
  'admin cria nota admin'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');
select lives_ok(
  $$ insert into customer_notes (customer_id, visibility, body) values
     ('a3333333-3333-4333-8333-333333333331', 'operational', 'Cliente pediu retorno em junho.') $$,
  'recepcao cria nota operational'
);
select throws_ok(
  $$ insert into customer_notes (customer_id, visibility, body) values
     ('a3333333-3333-4333-8333-333333333331', 'admin', 'Tentativa de nota admin.') $$,
  '42501', 'new row violates row-level security policy for table "customer_notes"',
  'recepcao nao cria nota admin (RLS)'
);
select is(
  (select count(*) from customer_notes),
  1::bigint, 'recepcao le so nota operational'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select lives_ok(
  $$ insert into customer_notes (customer_id, visibility, appointment_id, body) values
     ('a3333333-3333-4333-8333-333333333331', 'appointment', 'a4444444-4444-4444-8444-444444444441', 'Cabelo com progressiva.') $$,
  'professional cria nota de atendimento proprio'
);
select throws_ok(
  $$ insert into customer_notes (customer_id, visibility, appointment_id, body) values
     ('a3333333-3333-4333-8333-333333333331', 'appointment', 'a4444444-4444-4444-8444-444444444443', 'Nota em atendimento alheio.') $$,
  '42501', 'new row violates row-level security policy for table "customer_notes"',
  'professional nao cria nota em atendimento alheio (RLS)'
);
select throws_ok(
  $$ insert into customer_notes (customer_id, visibility, body) values
     ('a3333333-3333-4333-8333-333333333331', 'operational', 'Tentativa operational.') $$,
  '42501', 'new row violates row-level security policy for table "customer_notes"',
  'professional nao cria nota operational (RLS)'
);
select is(
  (select count(*) from customer_notes),
  1::bigint, 'professional le so nota do proprio atendimento'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  (select count(*) from customer_notes),
  3::bigint, 'admin le todas as notas'
);

-- ----------------------------------------------------------------------------
-- D. Filtros retornam subconjunto correto (sem financeiro).
-- ----------------------------------------------------------------------------
select is(
  (select jsonb_array_length(customer_filter(p_tag := 'vip')->'items')),
  1, 'filtro por tag vip retorna A1'
);
select is(
  (select jsonb_array_length(customer_filter(p_segment := 'novo')->'items')),
  1, 'filtro por segmento novo retorna A2'
);
select is(
  (select jsonb_array_length(customer_filter(p_no_show_min := 1)->'items')),
  1, 'filtro por no-show >= 1 retorna A1'
);
select is(
  (select jsonb_array_length(customer_filter(p_opt_in := false)->'items')),
  2, 'filtro por opt-in false retorna A2 e A3'
);

-- ----------------------------------------------------------------------------
-- E. Consentimento registra data/hora/versao; disparo bloqueado sem opt-in.
-- ----------------------------------------------------------------------------
select is(
  (select customer_can_receive_whatsapp('a3333333-3333-4333-8333-333333333332')),
  false, 'sem opt-in nao pode receber whatsapp'
);
select lives_ok(
  $$ select customer_consent_update('a3333333-3333-4333-8333-333333333332', true, 'v2') $$,
  'consent update registra opt-in com versao'
);
select is(
  (select customer_can_receive_whatsapp('a3333333-3333-4333-8333-333333333332')),
  true, 'com opt-in pode receber whatsapp'
);
select ok(
  (select lgpd_consent_at is not null and whatsapp_opt_in_at is not null
     from customers where id = 'a3333333-3333-4333-8333-333333333332'),
  'consent update carimba data/hora do opt-in e do LGPD'
);
select is(
  (select count(*) from audit_log
    where action = 'customer_consent_updated'
      and target_id = 'a3333333-3333-4333-8333-333333333332'),
  1::bigint, 'consent update auditado sem PII'
);

-- ----------------------------------------------------------------------------
-- F. RBAC financeiro: ticket medio so admin.
-- ----------------------------------------------------------------------------
select is(
  ((select customer_summary('a3333333-3333-4333-8333-333333333331')->>'avg_ticket_cents')::int),
  8000, 'admin ve ticket medio 8000'
);
select is(
  ((select customer_summary('a3333333-3333-4333-8333-333333333331')->>'total_paid_cents')::int),
  8000, 'admin ve total pago 8000'
);
select is(
  ((select customer_summary('a3333333-3333-4333-8333-333333333331')->>'loyalty_balance_points')::int),
  80, 'ficha 360 consome saldo fidelidade (80 pts)'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');
select ok(
  (select customer_summary('a3333333-3333-4333-8333-333333333331')->>'avg_ticket_cents' is null),
  'recepcao nao ve ticket medio (null)'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select ok(
  (select customer_summary('a3333333-3333-4333-8333-333333333331')->>'avg_ticket_cents' is null),
  'professional nao ve ticket medio (null)'
);

-- ----------------------------------------------------------------------------
-- G. Isolamento cross-tenant.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001', 'authenticated');
select throws_ok(
  $$ select customer_summary('a3333333-3333-4333-8333-333333333331') $$,
  'PT404', 'CUSTOMER_NOT_FOUND',
  'tenant B nao resume cliente do tenant A'
);
select is(
  (select count(*) from customers),
  1::bigint, 'tenant B ve so o proprio cliente'
);
select is(
  (select count(*) from customer_notes),
  0::bigint, 'tenant B nao ve notas do tenant A'
);

-- ----------------------------------------------------------------------------
-- H. Historico paginado (sem valores p/ nao-admin; total p/ admin).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  ((select customer_history('a3333333-3333-4333-8333-333333333331')->>'total')::int),
  3, 'historico totaliza 3 atendimentos de A1'
);
select is(
  (select jsonb_array_length(customer_history('a3333333-3333-4333-8333-333333333331', 1, 2)->'items')),
  2, 'historico pagina 1 com page_size 2 retorna 2 itens'
);

-- ----------------------------------------------------------------------------
-- I. Professional fora da agenda nao abre ficha alheia.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select throws_ok(
  $$ select customer_summary('a3333333-3333-4333-8333-333333333333') $$,
  'PT403', 'FORBIDDEN',
  'professional nao resume cliente fora da propria agenda'
);

select * from finish();
rollback;
