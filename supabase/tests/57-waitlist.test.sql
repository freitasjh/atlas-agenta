-- Teste da waitlist (ADR-04 Fase 4), pgTAP.
-- Prova: estrutura + RLS, enqueue idempotente (incl. professional null),
-- RBAC de escrita, fila por prioridade/validade, oferta com countdown + opt-in,
-- replay por event_key, confirm cria appointment, decline/expiração passam ao
-- próximo, trava anti-sobreposição (23P01), gestão manual + auditoria,
-- isolamento cross-tenant.
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Transação + rollback.

create extension if not exists pgtap with schema extensions;
begin;
select plan(40);

create or replace function pg_temp.wl_try(stmt text)
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
-- Fixture (owner): 2 tenants; admin/recepção/professional no A; admin no B.
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');

insert into professionals (id, tenant_id, name, profile_id) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A', 'a0000000-0000-4000-8000-000000000003');

insert into customers (id, tenant_id, name, phone, whatsapp_opt_in) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Opt-in', '+5511900000001', true),
  ('a3333333-3333-4333-8333-333333333332', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Sem Opt', '+5511900000002', false);

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Corte', 60, 8000);

-- ----------------------------------------------------------------------------
-- Estrutura.
-- ----------------------------------------------------------------------------
select has_table('waitlist_entries', 'tabela waitlist_entries existe');
select ok(
  (select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'waitlist_entries'),
  'RLS ativa em waitlist_entries'
);

-- ----------------------------------------------------------------------------
-- Enqueue idempotente (admin).
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $$ select waitlist_enqueue('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-01 00:00:00+00', '2030-05-02 00:00:00+00', 5) $$,
  'admin enfileira entrada com prioridade 5'
);
select is(
  (select count(*) from waitlist_entries),
  1::bigint, 'uma entrada na fila'
);
select is(
  (select (waitlist_enqueue('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-01 00:00:00+00', '2030-05-02 00:00:00+00', 5)->>'replayed')::boolean),
  true, 'duplicata ativa retorna replayed=true'
);
select is(
  (select count(*) from waitlist_entries),
  1::bigint, 'duplicata não cria segunda linha'
);

-- Professional null também é idempotente (NULL distinto em índice único; RPC cobre).
select lives_ok(
  $$ select waitlist_enqueue('a3333333-3333-4333-8333-333333333332', 'a2222222-2222-4222-8222-222222222222', null, '2030-05-01 00:00:00+00', '2030-05-02 00:00:00+00', 1) $$,
  'admin enfileira entrada sem professional (pool aberto)'
);
select is(
  (select (waitlist_enqueue('a3333333-3333-4333-8333-333333333332', 'a2222222-2222-4222-8222-222222222222', null, '2030-05-01 00:00:00+00', '2030-05-02 00:00:00+00', 1)->>'replayed')::boolean),
  true, 'duplicata com professional null retorna replayed=true'
);

-- Segunda entrada do mesmo cliente em período distinto: prioridade menor.
select lives_ok(
  $$ select waitlist_enqueue('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-03 00:00:00+00', '2030-05-04 00:00:00+00', 0) $$,
  'admin enfileira segunda entrada do cliente (período distinto)'
);

-- RBAC: professional não escreve.
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select throws_ok(
  $$ select waitlist_enqueue('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', null, '2030-05-01 00:00:00+00', '2030-05-02 00:00:00+00', 0) $$,
  'PT403', 'FORBIDDEN',
  'professional não enfileira (só leitura)'
);

-- ----------------------------------------------------------------------------
-- Oferta: primeiro elegível = maior prioridade; countdown + opt-in.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');

select is(
  (select waitlist_offer_next('a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 30, 'evt-cancel-1')->>'queued')::boolean,
  true, 'slot liberado gera oferta ao primeiro da fila'
);
select is(
  (select customer_id::text from waitlist_entries where status = 'ofertado' limit 1),
  'a3333333-3333-4333-8333-333333333331', 'oferta vai ao cliente de prioridade 5'
);
select is(
  (select (waitlist_offer_next('a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 30, 'evt-cancel-1')->>'replayed')::boolean),
  true, 'replay do mesmo evento não duplica oferta'
);
select is(
  (select count(*) from waitlist_entries where status = 'ofertado'),
  1::bigint, 'replay mantém uma única oferta'
);
select ok(
  (select offer_expires_at > now() + interval '29 minutes' from waitlist_entries where status = 'ofertado' limit 1),
  'countdown de 30 min aplicado à oferta'
);
select is(
  (select (waitlist_offer_next('a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 30, 'evt-cancel-1')->>'whatsapp_opt_in')::boolean),
  true, 'oferta expõe opt-in do cliente (disparo respeita LGPD)'
);

-- ----------------------------------------------------------------------------
-- Confirm cria appointment; decline passa ao próximo.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ select waitlist_respond((select id from waitlist_entries where status = 'ofertado' limit 1), true) $$,
  'confirmar oferta cria agendamento'
);
select is(
  (select count(*) from appointments where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and starts_at = '2030-05-01 10:00:00+00'),
  1::bigint, 'appointment criado no slot ofertado'
);
select is(
  (select status from appointments where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and starts_at = '2030-05-01 10:00:00+00' limit 1),
  'pendente', 'appointment nasce pendente'
);
select is(
  (select price_cents from appointments where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and starts_at = '2030-05-01 10:00:00+00' limit 1),
  8000, 'preço snapshot do serviço (centavos)'
);

-- Oferta do mesmo slot ao próximo + recusa passa adiante.
select lives_ok(
  $$ select waitlist_enqueue('a3333333-3333-4333-8333-333333333332', 'a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-01 00:00:00+00', '2030-05-02 00:00:00+00', 0) $$,
  'nova entrada com janela sobre o slot ocupado'
);
select lives_ok(
  $$ select waitlist_offer_next('a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 30, 'evt-cancel-2') $$,
  'slot gera oferta ao próximo da fila (pool aberto, prioridade 1)'
);
select lives_ok(
  $$ select waitlist_respond((select id from waitlist_entries where status = 'ofertado' limit 1), false) $$,
  'recusar oferta marca recusado e passa ao próximo'
);
select is(
  (select count(*) from waitlist_entries where status = 'recusado'),
  1::bigint, 'uma entrada recusada'
);
select is(
  (select customer_id::text from waitlist_entries where status = 'ofertado' limit 1),
  'a3333333-3333-4333-8333-333333333332', 'oferta passou ao próximo elegível'
);

-- Trava anti-sobreposição: confirmar segundo no mesmo slot/profissional falha.
select is(
  pg_temp.wl_try(
    $$ select waitlist_respond((select id from waitlist_entries where status = 'ofertado' limit 1), true) $$
  ),
  '23P01', 'confirmar em slot ocupado viola exclusion (sem corrida)'
);

-- ----------------------------------------------------------------------------
-- Expiração (job): oferta vencida expira.
-- ----------------------------------------------------------------------------
reset role;
update waitlist_entries set offer_expires_at = now() - interval '1 minute'
 where status = 'ofertado';

reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001', 'authenticated');
select cmp_ok(
  (select waitlist_expire_due(100)),
  '>=', 1, 'expire_due expira ofertas vencidas'
);
select is(
  (select count(*) from waitlist_entries where status = 'ofertado' and offer_expires_at < now()),
  0::bigint, 'nenhuma oferta vencida restante'
);

-- ----------------------------------------------------------------------------
-- Gestão manual + auditoria.
-- ----------------------------------------------------------------------------
select lives_ok(
  $$ select waitlist_set_priority((select id from waitlist_entries where status = 'aguardando' limit 1), 9) $$,
  'reordenar prioridade de entrada ativa'
);
select lives_ok(
  $$ select waitlist_mark_expired((select id from waitlist_entries where status = 'aguardando' limit 1)) $$,
  'marcar entrada ativa como expirada'
);
select lives_ok(
  $$ select waitlist_remove((select id from waitlist_entries where status in ('aguardando','expirado') limit 1)) $$,
  'remover entrada mantém trilha (cancelado)'
);
select is(
  (select status from waitlist_entries where id = (select target_id from audit_log where action = 'waitlist_removed' order by created_at desc limit 1)),
  'cancelado', 'remoção vira cancelado (sem DELETE físico)'
);
select lives_ok(
  $$ select waitlist_mark_attended((select id from waitlist_entries where status = 'confirmado' limit 1)) $$,
  'marcar confirmada como atendida'
);
select lives_ok(
  $$ select waitlist_enqueue('a3333333-3333-4333-8333-333333333332', 'a2222222-2222-4222-8222-222222222222', null, '2030-06-01 00:00:00+00', '2030-06-02 00:00:00+00', 0) $$,
  'nova entrada aguardando para guarda de transição'
);
select throws_ok(
  $$ select waitlist_mark_attended((select id from waitlist_entries where status = 'aguardando' limit 1)) $$,
  'PT409', 'ENTRY_NOT_CONFIRMED',
  'atendida exige status confirmado'
);
select ok(
  (select count(*) >= 5 from audit_log where target_type = 'waitlist_entry' and tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'auditoria registra eventos da waitlist'
);

-- ----------------------------------------------------------------------------
-- RLS: professional lê só o próprio; cross-tenant isolado.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003', 'authenticated');
select cmp_ok(
  (select count(*) from waitlist_entries),
  '>=', 3::bigint, 'professional enxerga entradas vinculadas ao próprio professional'
);
select is(
  (select count(*) from waitlist_entries where professional_id is null),
  0::bigint, 'professional não enxerga entradas do pool aberto (só as vinculadas)'
);

reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001', 'authenticated');
select is(
  (select count(*) from waitlist_entries),
  0::bigint, 'tenant B não enxerga fila do tenant A'
);
select throws_ok(
  $$ select waitlist_enqueue('a3333333-3333-4333-8333-333333333331', 'a2222222-2222-4222-8222-222222222222', null, '2030-05-01 00:00:00+00', '2030-05-02 00:00:00+00', 0) $$,
  'PT404', 'CUSTOMER_NOT_FOUND',
  'enqueue cross-tenant (cliente de outro tenant) falha'
);

select * from finish();
rollback;
