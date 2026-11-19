-- Teste de pacotes de sessões (ADR-02 Fase 2), pgTAP.
-- Prova: venda (admin/receptionist), baixa automática ao concluir no mesmo commit,
-- cancelado NÃO estorna, vencido/zerado recusam com erro tipado, RLS cross-tenant nega,
-- recepção vende mas não executa baixa direta, comissão segue preço cheio (G1 intocado).
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Roda numa transação e dá
-- rollback: nada persiste.

create extension if not exists pgtap with schema extensions;
begin;
select plan(34);

-- Helper local: executa o statement e devolve o SQLSTATE do erro, ou 'ok'.
create or replace function pg_temp.pkg_try(stmt text)
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
-- Fixture (owner): 2 tenants, admin/recepção/profissional no tenant A, admin no B,
-- profissional, cliente, 2 serviços, atendimentos em dias distintos (sem sobreposição).
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');

insert into professionals (id, tenant_id, name, profile_id) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A', 'a0000000-0000-4000-8000-000000000003');

insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A1', '+5511900000001');

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Limpeza de Pele', 60, 15000),
  ('a2222222-2222-4222-8222-222222222223', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Massagem', 60, 20000);

-- 9 atendimentos pendentes, um por dia (exclusão de sobreposição nunca dispara).
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444441', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-01 10:00:00+00', '2030-04-01 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444442', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-02 10:00:00+00', '2030-04-02 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444443', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-03 10:00:00+00', '2030-04-03 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-04 10:00:00+00', '2030-04-04 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444445', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-05 10:00:00+00', '2030-04-05 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444446', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-06 10:00:00+00', '2030-04-06 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444447', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-07 10:00:00+00', '2030-04-07 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444448', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-04-08 10:00:00+00', '2030-04-08 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444449', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222223', '2030-04-09 10:00:00+00', '2030-04-09 11:00:00+00', 20000, 'pendente');

-- Lookup de crédito por chave natural (customer + total distinto por crédito,
-- legível sob RLS em qualquer papel; evita temp table cross-role).

-- ----------------------------------------------------------------------------
-- Estrutura.
-- ----------------------------------------------------------------------------
select has_table('package_credits', 'tabela package_credits existe');
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'package_credits'),
  'RLS ativa em package_credits'
);
select has_column('appointments', 'package_credit_id', 'appointments tem vínculo opcional de pacote');

-- ----------------------------------------------------------------------------
-- Venda: admin e recepção vendem; crédito nasce zerado, ativo, com validade.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 5, 60000, 30) $$,
  'admin vende pacote (5 sessões, 30 dias)'
);

select is(
  (select total_sessions from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)),
  5, 'crédito nasce com total de 5 sessões'
);
select is(
  (select used_sessions from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)),
  0, 'crédito nasce zerado'
);
select is(
  (select status from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)),
  'active', 'crédito nasce ativo'
);
select ok(
  (select expires_at > now() + interval '29 days' from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)),
  'validade conta desde a venda (30 dias)'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002', 'authenticated');

select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 2, 24000, 30) $$,
  'recepção vende pacote'
);

-- Recepção não executa baixa direta.
select throws_ok(
  $$ select redeem_session((select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2), 'a4444444-4444-4444-8444-444444444441') $$,
  '42501', 'PACKAGE_REDEEM_DENIED',
  'recepção não conclui baixa direta (redeem negado)'
);

-- Recepção não burla via package_consume direto.
select throws_ok(
  $$ select package_consume((select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2), 'a4444444-4444-4444-8444-444444444441') $$,
  '42501', 'PACKAGE_REDEEM_DENIED',
  'recepção não consome direto via package_consume (bypass negado)'
);

-- Recepção não burla passando skip=true explícito (só o trigger pode usar skip).
select throws_ok(
  $$ select package_consume((select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2), 'a4444444-4444-4444-8444-444444444441', true) $$,
  '42501', 'PACKAGE_REDEEM_DENIED',
  'recepção não burla via package_consume com skip=true'
);

-- Recepção não burla passando skip=NULL (NULL comporta-se como false: cai no gate da via direta).
select throws_ok(
  $$ select package_consume((select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2), 'a4444444-4444-4444-8444-444444444441', NULL) $$,
  '42501', 'PACKAGE_REDEEM_DENIED',
  'recepção não burla via package_consume com skip=NULL'
);

-- ----------------------------------------------------------------------------
-- Baixa automática ao concluir (mesmo commit); comissão segue preço cheio.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set package_credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)
     where id = 'a4444444-4444-4444-8444-444444444441';
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444441';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444441';
  end $inner$ $sql$,
  'concluir atendimento vinculado baixa 1 sessão no mesmo commit'
);
select is(
  (select used_sessions from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)),
  1, 'used_sessions soma 1 ao concluir'
);
select is(
  (select base_cents from appointment_commissions where appointment_id = 'a4444444-4444-4444-8444-444444444441'),
  15000, 'comissão apurada sobre preço cheio (G1 intocado)'
);
select is(
  (select remaining from get_package_balance('a3333333-3333-4333-8333-333333333331')
    where credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)),
  4, 'saldo mostra 4 restantes de 5'
);

-- ----------------------------------------------------------------------------
-- Cancelado não estorna.
-- ----------------------------------------------------------------------------
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set package_credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)
     where id = 'a4444444-4444-4444-8444-444444444442';
    update appointments set status = 'cancelado' where id = 'a4444444-4444-4444-8444-444444444442';
  end $inner$ $sql$,
  'cancelar atendimento vinculado não mexe no crédito'
);
select is(
  (select used_sessions from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 5)),
  1, 'used_sessions inalterado após cancelado (sem estorno)'
);

-- ----------------------------------------------------------------------------
-- Vencido recusa com erro tipado e marca expired.
-- ----------------------------------------------------------------------------
reset role;
update package_credits set expires_at = now() - interval '1 day'
 where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select throws_ok(
  $sql$ DO $inner$ begin
    update appointments set package_credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2)
     where id = 'a4444444-4444-4444-8444-444444444443';
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444443';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444443';
  end $inner$ $sql$,
  'P0001', 'PACKAGE_CREDIT_EXPIRED',
  'concluir com crédito vencido recusa com erro tipado'
);
select is(
  (select used_sessions from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2)),
  0, 'vencido não baixa sessão'
);
select is(
  (select expired from get_package_balance('a3333333-3333-4333-8333-333333333331')
    where credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 2)),
  true, 'saldo sinaliza crédito vencido ao vivo'
);

-- ----------------------------------------------------------------------------
-- Zerado recusa com erro tipado e marca exhausted.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 1, 12000, 30) $$,
  'admin vende pacote de 1 sessão'
);
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set package_credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 1)
     where id = 'a4444444-4444-4444-8444-444444444444';
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444444';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444444';
  end $inner$ $sql$,
  'única sessão do pacote baixa ao concluir'
);
select is(
  (select used_sessions from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 1)),
  1, 'pacote de 1 sessão fica zerado'
);
select is(
  (select status from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 1)),
  'exhausted', 'pacote zerado marca exhausted'
);
select throws_ok(
  $sql$ DO $inner$ begin
    update appointments set package_credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 1)
     where id = 'a4444444-4444-4444-8444-444444444445';
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444445';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444445';
  end $inner$ $sql$,
  'P0001', 'PACKAGE_CREDIT_EXHAUSTED',
  'concluir com pacote zerado recusa com erro tipado'
);

-- ----------------------------------------------------------------------------
-- RLS: tenant B não lê crédito do tenant A; venda cross-tenant falha.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001', 'authenticated');

select is(
  (select count(*) from package_credits),
  0::bigint, 'tenant B não enxerga créditos do tenant A'
);
select is(
  pg_temp.pkg_try(
    $$ select sell_package('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 1, 12000, 30) $$
  ),
  '23503', 'venda cross-tenant (cliente de outro tenant) falha'
);

-- ----------------------------------------------------------------------------
-- Profissional executa baixa direta; vínculo trocado de serviço recusa.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 4, 48000, 30) $$,
  'admin vende pacote c4 (4 sessões)'
);
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set package_credit_id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 4)
     where id = 'a4444444-4444-4444-8444-444444444446';
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444446';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444446';
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444447';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444447';
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444449';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444449';
  end $inner$ $sql$,
  'conclui vinculados e um avulso de outro serviço'
);

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');

select lives_ok(
  $$ select redeem_session((select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 4), 'a4444444-4444-4444-8444-444444444447') $$,
  'profissional executa baixa direta em atendimento concluído'
);
select is(
  (select used_sessions from package_credits where id = (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 4)),
  2, 'baixa direta do profissional soma ao consumo do trigger'
);
select throws_ok(
  $$ select redeem_session((select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333331' and total_sessions = 4), 'a4444444-4444-4444-8444-444444444449') $$,
  'P0001', 'PACKAGE_CREDIT_MISMATCH',
  'baixa em atendimento de outro serviço recusa (mismatch)'
);

select * from finish();
rollback;
