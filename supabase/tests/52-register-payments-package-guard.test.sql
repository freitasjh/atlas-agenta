-- Guarda anti-dupla-cobrança em register_appointment_payments (review CHANGES_REQUIRED, 1 🔴).
-- Prova: lote com pagamento + crédito válido => PT409 PACKAGE_CREDIT_AVAILABLE e nada
-- escrito; lote vazio + close segue o caminho do pacote (trigger consome); replay
-- idempotente não é recusado; crédito só-vencido/esgotado ou de outro serviço segue avulso.
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Roda numa transação e dá
-- rollback: nada persiste. Chamadas à RPC rodam como owner (`reset role`): a RPC é
-- security invoker com grants só p/ service_role, e o owner avalia o corpo sem o gate
-- de permissão — o que se prova aqui é a guarda de domínio, não o grant (coberto no
-- REST de integração). Vendas (`sell_package`, security definer com gate de papel)
-- rodam como admin autenticado.
create extension if not exists pgtap with schema extensions;
begin;
select plan(19);

create or replace function pg_temp.guard_try(stmt text)
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
-- Fixture (owner): admin no tenant A, profissional, 3 clientes, 2 serviços,
-- 6 atendimentos em dias distintos (sem sobreposição), todos em_atendimento.
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000021', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');

insert into professionals (id, tenant_id, name) values
  ('a1111111-1111-4111-8111-111111111131', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A');

insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333341', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Pacote', '+5511900000041'),
  ('a3333333-3333-4333-8333-333333333342', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Vencido', '+5511900000042'),
  ('a3333333-3333-4333-8333-333333333343', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Esgotado', '+5511900000043');

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222241', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Limpeza de Pele', 60, 15000),
  ('a2222222-2222-4222-8222-222222222242', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Massagem', 60, 20000);

insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444461', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333341', 'a1111111-1111-4111-8111-111111111131', 'a2222222-2222-4222-8222-222222222241', '2030-06-01 10:00:00+00', '2030-06-01 11:00:00+00', 15000, 'em_atendimento'),
  ('a4444444-4444-4444-8444-444444444462', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333341', 'a1111111-1111-4111-8111-111111111131', 'a2222222-2222-4222-8222-222222222241', '2030-06-02 10:00:00+00', '2030-06-02 11:00:00+00', 15000, 'em_atendimento'),
  ('a4444444-4444-4444-8444-444444444463', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333342', 'a1111111-1111-4111-8111-111111111131', 'a2222222-2222-4222-8222-222222222241', '2030-06-03 10:00:00+00', '2030-06-03 11:00:00+00', 15000, 'em_atendimento'),
  ('a4444444-4444-4444-8444-444444444464', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333341', 'a1111111-1111-4111-8111-111111111131', 'a2222222-2222-4222-8222-222222222242', '2030-06-04 10:00:00+00', '2030-06-04 11:00:00+00', 20000, 'em_atendimento'),
  ('a4444444-4444-4444-8444-444444444465', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333343', 'a1111111-1111-4111-8111-111111111131', 'a2222222-2222-4222-8222-222222222241', '2030-06-05 10:00:00+00', '2030-06-05 11:00:00+00', 15000, 'em_atendimento'),
  ('a4444444-4444-4444-8444-444444444466', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333341', 'a1111111-1111-4111-8111-111111111131', 'a2222222-2222-4222-8222-222222222241', '2030-06-06 10:00:00+00', '2030-06-06 11:00:00+00', 15000, 'em_atendimento'),
  ('a4444444-4444-4444-8444-444444444467', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333341', 'a1111111-1111-4111-8111-111111111131', 'a2222222-2222-4222-8222-222222222241', '2030-06-07 10:00:00+00', '2030-06-07 11:00:00+00', 15000, 'em_atendimento');

-- Pagamento avulso ANTES de existir crédito: prova a base (e gera a chave do replay).
reset role;
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444466', '[{"method":"dinheiro","amount_cents":15000}]'::jsonb, 'c6666666-6666-4666-8666-666666666666', true) $$,
  'sem credito: lote com pagamento conclui avulso'
);

-- Venda do pacote (admin autenticado) + vencido/esgotado (owner ajusta o estado).
select tests.authenticate_as('a0000000-0000-4000-8000-000000000021', 'authenticated');
select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333341', 'a2222222-2222-4222-8222-222222222241', 5, 60000, 30) $$,
  'admin vende pacote de 5 sessoes (credito valido)'
);
select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333342', 'a2222222-2222-4222-8222-222222222241', 1, 12000, 30) $$,
  'admin vende pacote de 1 sessao (sera vencido)'
);
select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333343', 'a2222222-2222-4222-8222-222222222241', 1, 12000, 30) $$,
  'admin vende pacote de 1 sessao (sera esgotado)'
);

reset role;
update package_credits set expires_at = now() - interval '1 day'
 where customer_id = 'a3333333-3333-4333-8333-333333333342';
update package_credits set used_sessions = 1, status = 'exhausted'
 where customer_id = 'a3333333-3333-4333-8333-333333333343';

-- Replay da chave anterior (nada novo escrito) NÃO é recusado, mesmo com crédito
-- válido agora existente: a guarda vive depois do retorno do replay.
select is(
  ((select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444466', '[{"method":"dinheiro","amount_cents":15000}]'::jsonb, 'c6666666-6666-4666-8666-666666666666', true))::jsonb ->> 'replayed')::boolean,
  true, 'replay identico com credito valido posterior nao e recusado'
);

-- Lote com pagamento + crédito válido => PT409 PACKAGE_CREDIT_AVAILABLE, sem escrita.
select throws_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444461', '[{"method":"dinheiro","amount_cents":15000}]'::jsonb, 'c6111111-1111-4111-8111-111111111111', true) $$,
  'PT409', 'PACKAGE_CREDIT_AVAILABLE',
  'lote com pagamento e credito valido recusa com erro tipado'
);
select is(
  (select status from appointments where id = 'a4444444-4444-4444-8444-444444444461'),
  'em_atendimento', 'recusa nao muda o status (nada escrito)'
);
select is(
  (select count(*) from appointment_payments where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and appointment_id = 'a4444444-4444-4444-8444-444444444461'),
  0::bigint, 'recusa nao grava linha no ledger'
);

-- Lote com PIX do sistema + crédito válido também recusa (intenção PIX conta).
select throws_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444461', '[{"method":"pix_sistema","amount_cents":15000}]'::jsonb, 'c6111111-1111-4111-8111-111111111112', true) $$,
  'PT409', 'PACKAGE_CREDIT_AVAILABLE',
  'intencao PIX com credito valido recusa com erro tipado'
);

-- Lote vazio + close segue o caminho do pacote: conclui e o trigger consome 1.
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444462', '[]'::jsonb, 'c6222222-2222-4222-8222-222222222222', true) $$,
  'lote vazio + close com credito valido conclui (caminho do pacote)'
);
select is(
  (select status from appointments where id = 'a4444444-4444-4444-8444-444444444462'),
  'concluido', 'caminho do pacote conclui o atendimento'
);
select is(
  (select used_sessions from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333341' and total_sessions = 5),
  1, 'caminho do pacote consome 1 sessao via trigger'
);
select is(
  (select package_credit_id from appointments where id = 'a4444444-4444-4444-8444-444444444462'),
  (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333341' and total_sessions = 5),
  'caminho do pacote grava o vinculo (auto-vinculo)'
);

-- Só crédito vencido: lote segue avulso.
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444463', '[{"method":"dinheiro","amount_cents":15000}]'::jsonb, 'c6333333-3333-4333-8333-333333333333', true) $$,
  'so credito vencido: lote segue avulso'
);
select is(
  (select status from appointments where id = 'a4444444-4444-4444-8444-444444444463'),
  'concluido', 'vencido nao bloqueia o avulso'
);

-- Só crédito esgotado: lote segue avulso.
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444465', '[{"method":"dinheiro","amount_cents":15000}]'::jsonb, 'c6555555-5555-4555-8555-555555555555', true) $$,
  'so credito esgotado: lote segue avulso'
);

-- Outro serviço: lote segue avulso (guarda é por cliente+serviço).
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444464', '[{"method":"dinheiro","amount_cents":20000}]'::jsonb, 'c6444444-4444-4444-8444-444444444444', true) $$,
  'outro servico: lote segue avulso'
);

-- Contexto de serviço (sem JWT, como a Edge service_role): lote vazio + close
-- conclui e o trigger consome via fallback de tenant (sem 42501).
select tests.clear_authentication();
select lives_ok(
  $$ select register_appointment_payments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000021', 'a4444444-4444-4444-8444-444444444467', '[]'::jsonb, 'c6777777-7777-4777-8777-777777777777', true) $$,
  'sem JWT: lote vazio + close conclui (fallback de tenant no consume)'
);
select is(
  (select used_sessions from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333341' and total_sessions = 5),
  2, 'sem JWT: trigger consumiu a 2a sessao'
);

select * from finish();
rollback;
