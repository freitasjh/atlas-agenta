-- Teste das métricas WhatsApp (ADR-11 Fase 4), pgTAP.
-- Prova: schema (colunas/funil RLS inalterada), KPIs unificando régua + campanhas +
-- confirmadas via confirmed_via, log filtrável (status/template/direção/busca/página,
-- sem telefone em claro), ban risk com limiares da pergunta 10, RBAC admin-only (PT403),
-- período inválido (PT400) e isolamento cross-tenant.
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Transação + rollback.

create extension if not exists pgtap with schema extensions;
begin;
select plan(38);

-- ----------------------------------------------------------------------------
-- Fixture (owner): 2 tenants; admin/recepção/professional no A; admin no B.
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'admin', 'Admin B');

insert into professionals (id, tenant_id, name) values
  ('a1111111-1111-4111-8111-1111111111a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Prof A');
insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-2222222222a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Corte', 60, 8000);

insert into customers (id, tenant_id, name, phone, whatsapp_opt_in) values
  ('a3333333-3333-4333-8333-3333333333a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Um', '+5511900000011', true),
  ('a3333333-3333-4333-8333-3333333333a2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Dois', '+5511900000022', true),
  ('a3333333-3333-4333-8333-3333333333a3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Tres', '+5511900000033', true),
  ('a3333333-3333-4333-8333-3333333333a4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Quatro', '+5511900000044', true),
  ('a3333333-3333-4333-8333-3333333333a5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Cinco', '+5511900000055', true),
  ('a3333333-3333-4333-8333-3333333333a6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Seis', '+5511900000066', true),
  ('a3333333-3333-4333-8333-3333333333a7', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Sete', '+5511900000077', true),
  ('a3333333-3333-4333-8333-3333333333a8', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Cli Oito', '+5511900000088', true),
  ('b3333333-3333-4333-8333-3333333333b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Cli B', '+5511900000099', true);

-- Campanha (ADR-05) para unificar no funil.
insert into campaign_templates (id, tenant_id, name, body) values
  ('a4444444-4444-4444-8444-4444444444a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Win-back', 'Volte! {nome}');
insert into campaigns (id, tenant_id, name, preset, template_id, status) values
  ('a5555555-5555-4555-8555-5555555555a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Camp 1', 'win_back',
   'a4444444-4444-4444-8444-4444444444a1', 'enviando');

insert into campaign_sends (tenant_id, campaign_id, customer_id, status, created_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a1', 'sent', '2026-09-05 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a2', 'delivered', '2026-09-06 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a3', 'read', '2026-09-07 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a4', 'replied', '2026-09-08 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a5', 'converted', '2026-09-09 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a6', 'failed', '2026-09-10 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a7', 'excluded_opt_in', '2026-09-11 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a5555555-5555-4555-8555-5555555555a1', 'a3333333-3333-4333-8333-3333333333a8', 'queued', '2026-09-12 12:00:00+00');

-- Régua (messages): 4 efetivos + 2 falhas + 1 entrada + 1 em fila.
insert into messages (tenant_id, customer_id, channel, template, status, direction, provider_message_id, failure_reason, dedupe_key, delivered_at, read_at, campaign_id, created_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a1', 'whatsapp', 'confirmacao', 'enviado', 'saida', 'pv-001', null, 'k-001', null, null, null, '2026-09-05 10:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a1', 'whatsapp', 'lembrete_d1', 'entregue', 'saida', 'pv-002', null, 'k-002', '2026-09-06 10:00:00+00', null, 'a5555555-5555-4555-8555-5555555555a1', '2026-09-06 10:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a1', 'whatsapp', 'confirmacao', 'lida', 'saida', 'pv-003', null, 'k-003', '2026-09-07 10:00:00+00', '2026-09-07 11:00:00+00', null, '2026-09-07 10:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a1', 'whatsapp', 'cobranca', 'respondida', 'saida', 'pv-004', null, 'k-004', '2026-09-08 10:00:00+00', '2026-09-08 11:00:00+00', null, '2026-09-08 10:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a2', 'whatsapp', 'lembrete_d1', 'falha', 'saida', 'pv-005', 'provedor_recusou', 'k-005', null, null, null, '2026-09-09 10:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a2', 'whatsapp', 'confirmacao', 'falha', 'saida', 'pv-006', 'numero_bloqueado', 'k-006', null, null, null, '2026-09-10 10:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a2', 'whatsapp', 'resposta', 'entregue', 'entrada', null, null, 'k-007', null, null, null, '2026-09-11 10:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a2', 'whatsapp', 'confirmacao', 'fila', 'saida', null, null, 'k-008', null, null, null, '2026-09-12 10:00:00+00');

-- Tenant B: 1 enviado no período (isolamento).
insert into messages (tenant_id, customer_id, channel, template, status, direction, dedupe_key, created_at) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'b3333333-3333-4333-8333-3333333333b1', 'whatsapp', 'confirmacao', 'enviado', 'saida', 'kb-001', '2026-09-06 10:00:00+00');

-- Confirmadas: 1 via WhatsApp (período) + 1 manual (fora da contagem).
insert into appointments (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status, confirmed_via) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a1', 'a1111111-1111-4111-8111-1111111111a1', 'a2222222-2222-4222-8222-2222222222a1', '2026-09-20 12:00:00+00', '2026-09-20 12:30:00+00', 8000, 'confirmado', 'cliente_whatsapp'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'a3333333-3333-4333-8333-3333333333a2', 'a1111111-1111-4111-8111-1111111111a1', 'a2222222-2222-4222-8222-2222222222a1', '2026-09-21 12:00:00+00', '2026-09-21 12:30:00+00', 8000, 'confirmado', 'manual');
-- O trigger carimba confirmed_at=now(); traz para o período como owner.
update appointments set confirmed_at = '2026-09-20 13:00:00+00'
 where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and confirmed_via = 'cliente_whatsapp';

-- ----------------------------------------------------------------------------
-- A. Estrutura.
-- ----------------------------------------------------------------------------
select has_table('messages', 'tabela messages existe');
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'messages'),
  'RLS ativa em messages'
);
select has_column('messages', 'direction', 'coluna direction existe');
select has_column('messages', 'delivered_at', 'coluna delivered_at existe');
select has_column('messages', 'campaign_id', 'coluna campaign_id existe');

-- ----------------------------------------------------------------------------
-- B–G como admin do tenant A.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-0000000000a1', 'authenticated');

-- B. KPIs: régua (4 enviadas, 3 entregues, 2 lidas, 2 respostas, 2 falhas)
--    + sends (5/4/3/1/1) = 9/7/5/3/3; confirmadas 1.
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'enviadas')::int,
  9, 'KPIs: enviadas = 4 régua + 5 sends'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'entregues')::int,
  7, 'KPIs: entregues = 3 régua + 4 sends'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'lidas')::int,
  5, 'KPIs: lidas = 2 régua + 3 sends'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'respostas')::int,
  3, 'KPIs: respostas = entrada + respondida + replied'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'falhas')::int,
  3, 'KPIs: falhas = 2 régua + 1 send'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'confirmadas')::int,
  1, 'KPIs: confirmadas só via cliente_whatsapp no período'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'delivery_rate')::numeric,
  0.7778::numeric, 'KPIs: delivery_rate 7/9'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'read_rate')::numeric,
  0.7143::numeric, 'KPIs: read_rate 5/7'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'failure_rate')::numeric,
  0.25::numeric, 'KPIs: failure_rate 3/12'
);
select ok(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00')->'items'))::text not like '%"phone"%',
  'LGPD: log não expõe telefone em claro'
);

-- C. Ban risk: 3/12 = 0.25 > 0.15 + 1 bloqueio explícito → critico.
select is(
  ((select whatsapp_ban_risk('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'level'),
  'critico', 'ban risk: nível critico (taxa + bloqueio explícito)'
);
select is(
  ((select whatsapp_ban_risk('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'failure_rate')::numeric,
  0.25::numeric, 'ban risk: failure_rate 0.25'
);
select is(
  ((select whatsapp_ban_risk('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'blocked_count')::int,
  1, 'ban risk: 1 bloqueio explícito (numero_bloqueado)'
);
select is(
  (select whatsapp_ban_risk('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00')->'thresholds'),
  '{"warn": 0.05, "critical": 0.15}'::jsonb, 'ban risk: limiares da pergunta 10 (warn 5%, crítico 15%)'
);
select ok(
  char_length((select whatsapp_ban_risk('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'recommendation') > 0,
  'ban risk: recomendação presente (alerta, sem auto-bloqueio)'
);

-- D. Log filtrável: 8 linhas no período.
select is(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'total')::int,
  8, 'log: total 8 no período (fila inclusa, sem vazar tenant B)'
);
select is(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', 'falha'))->>'total')::int,
  2, 'log: filtro status=falha → 2'
);
select is(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', null, 'confirmacao'))->>'total')::int,
  4, 'log: filtro template=confirmacao → 4 (inclui fila)'
);
select is(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', null, null, 'entrada'))->>'total')::int,
  1, 'log: filtro direction=entrada → 1'
);
select is(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', null, null, null, 'bloqueado'))->>'total')::int,
  1, 'log: busca em failure_reason → 1'
);
select is(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', null, null, null, 'Cli Um'))->>'total')::int,
  4, 'log: busca por nome do cliente → 4'
);
select is(
  jsonb_array_length((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', null, null, null, null, 2, 3)->'items')),
  3, 'log: página 2 com size 3 → 3 itens'
);
select is(
  ((select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', null, null, null, null, 2, 3)->>'total'))::int,
  8, 'log: paginação preserva total 8'
);
select throws_ok(
  $$ select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', 'invalido') $$,
  'PT400', 'INVALID_STATUS',
  'log: status inválido → PT400'
);
select throws_ok(
  $$ select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00', null, null, null, null, 0, 20) $$,
  'PT400', 'INVALID_PAGE',
  'log: página 0 → PT400'
);

-- E. RBAC: recepção/profissional negados nas 3 RPCs (RF-41).
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-0000000000a2', 'authenticated');
select throws_ok(
  $$ select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00') $$,
  'PT403', 'FORBIDDEN',
  'recepção: kpis negados'
);
select throws_ok(
  $$ select whatsapp_ban_risk('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00') $$,
  'PT403', 'FORBIDDEN',
  'recepção: ban risk negado'
);
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-0000000000a3', 'authenticated');
select throws_ok(
  $$ select whatsapp_message_log('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00') $$,
  'PT403', 'FORBIDDEN',
  'profissional: log negado'
);
select throws_ok(
  $$ select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00') $$,
  'PT403', 'FORBIDDEN',
  'profissional: kpis negados'
);

-- F. Período inválido.
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-0000000000a1', 'authenticated');
select throws_ok(
  $$ select whatsapp_kpis('2026-10-01 00:00:00+00', '2026-10-01 00:00:00+00') $$,
  'PT400', 'INVALID_PERIOD',
  'kpis: p_to = p_from → PT400'
);
select throws_ok(
  $$ select whatsapp_ban_risk('2024-01-01 00:00:00+00', '2026-01-01 00:00:00+00') $$,
  'PT400', 'INVALID_PERIOD',
  'ban risk: janela > 366 dias → PT400'
);

-- G. Isolamento cross-tenant: admin B vê só a própria linha.
reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-0000000000b1', 'authenticated');
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'enviadas')::int,
  1, 'isolamento: tenant B conta só a própria enviada'
);
select is(
  ((select whatsapp_kpis('2026-09-01 00:00:00+00', '2026-10-01 00:00:00+00'))->>'falhas')::int,
  0, 'isolamento: falhas do tenant A não vazam p/ B'
);

select * from finish();
rollback;
