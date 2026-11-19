-- Regressão H3 Fase 2 (v1.4 RF-01 + RF-12), pgTAP.
-- Causas raiz provadas contra Supabase local (PostgREST autenticado):
--   (1) policy `clinical_records_insert` exigia atendimento em
--       ('em_atendimento','concluido'). O fluxo H3 cria o agendamento via UI
--       (status `pendente`) e abre o prontuário/anamnese antes de iniciar o
--       atendimento -> 403 (42501) para o admin. v1.4 RF-01 redefine o
--       elegível: ficha/evolução em qualquer status não-final
--       (pendente/confirmado/em_atendimento/concluido); só cancelado e
--       nao_compareceu (sem cuidado) recusam.
--   (2) `appointments.package_credit_id` nunca é preenchido pela UI
--       (create/update não enviam a coluna), então o trigger de baixa só
--       disparava com vínculo manual e o concluir H3 mantinha 0/5. RF-12:
--       ao entrar em `concluido` sem vínculo, o banco auto-vincula o melhor
--       crédito válido (mesmo cliente+serviço, ativo, não vencido, com saldo,
--       FIFO por vencimento) e baixa 1 no mesmo commit; sem crédito válido
--       o concluir segue avulso (sem falhar); cancelado nunca consome.
--
-- Papéis reais via tests.authenticate_as; inserts de ficha omitem tenant_id,
-- created_by e created_at (fiel ao PostgREST da UI — defaults do banco).
-- Roda numa transação e dá rollback: nada persiste.
--
-- Fixture própria, domínio `.invalido` (guarda do harness, ADR-04).

create extension if not exists pgtap with schema extensions;
begin;
select plan(23);

create or replace function pg_temp.h3_try(stmt text)
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
-- Fixture (owner): admin/recepção/profissional no tenant A, admin no B,
-- profissional vinculado, cliente, 2 serviços, crédito de 5 sessões (S1).
-- ----------------------------------------------------------------------------
select tests.create_user('a0000000-0000-4000-8000-000000000011', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('a0000000-0000-4000-8000-000000000012', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receptionist', 'Recepcao A');
select tests.create_user('a0000000-0000-4000-8000-000000000013', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'professional', 'Profissional A');
select tests.create_user('b0000000-0000-4000-8000-000000000011', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');

update tenants set segment = 'clinica', subscription_status = 'trial'
  where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

insert into professionals (id, tenant_id, name, profile_id) values
  ('a1111111-1111-4111-8111-111111111121', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A', 'a0000000-0000-4000-8000-000000000013');

insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333321', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente H3', '+5511900000031');

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222221', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Limpeza de Pele', 60, 15000),
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Massagem', 60, 20000);

insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333322', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente H3 Avulso', '+5511900000032');

-- Atendimentos em dias distintos (sem sobreposição): P1..P4 para a ficha,
-- A5/A5b para a baixa, A6 (outro serviço), A7 (cancelar), A8 (vencido).
insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444451', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-01 10:00:00+00', '2030-05-01 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444452', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-02 10:00:00+00', '2030-05-02 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444453', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-03 10:00:00+00', '2030-05-03 11:00:00+00', 15000, 'cancelado'),
  ('a4444444-4444-4444-8444-444444444454', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-04 10:00:00+00', '2030-05-04 11:00:00+00', 15000, 'nao_compareceu'),
  ('a4444444-4444-4444-8444-444444444455', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-05 10:00:00+00', '2030-05-05 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444456', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-06 10:00:00+00', '2030-05-06 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444457', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222222', '2030-05-07 10:00:00+00', '2030-05-07 11:00:00+00', 20000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444458', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333321', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-08 10:00:00+00', '2030-05-08 11:00:00+00', 15000, 'pendente'),
  ('a4444444-4444-4444-8444-444444444459', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333322', 'a1111111-1111-4111-8111-111111111121', 'a2222222-2222-4222-8222-222222222221', '2030-05-09 10:00:00+00', '2030-05-09 11:00:00+00', 15000, 'pendente');

-- Venda do pacote de 5 sessões (S1) como admin; crédito nasce 0/5.
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');
select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333321', 'a2222222-2222-4222-8222-222222222221', 5, 60000, 30) $$,
  'H3 setup: admin vende pacote de 5 sessoes'
);

-- ============================================================================
-- RF-01: ficha/evolução em status não-final (sem tenant_id no insert, como a UI).
-- ============================================================================

-- 1. Admin insere ficha em atendimento pendente (fluxo H3: criado via UI).
select lives_ok(
  $sql$
    insert into clinical_records (customer_id, appointment_id, clinical_notes)
    values ('a3333333-3333-4333-8333-333333333321', 'a4444444-4444-4444-8444-444444444451', 'Anamnese H3 em pendente')
  $sql$,
  'admin insere ficha em atendimento pendente (defaults preenchem tenant/autor)'
);

-- 2. Admin insere ficha em atendimento confirmado.
reset role;
update appointments set status = 'confirmado'
  where id = 'a4444444-4444-4444-8444-444444444452';
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');
select lives_ok(
  $sql$
    insert into clinical_records (customer_id, appointment_id, clinical_notes)
    values ('a3333333-3333-4333-8333-333333333321', 'a4444444-4444-4444-8444-444444444452', 'Evolucao H3 em confirmado')
  $sql$,
  'admin insere ficha em atendimento confirmado'
);

-- 3. Cancelado segue recusado (sem cuidado, sem ficha).
select is(
  pg_temp.h3_try(
    $sql$
      insert into clinical_records (customer_id, appointment_id, clinical_notes)
      values ('a3333333-3333-4333-8333-333333333321', 'a4444444-4444-4444-8444-444444444453', 'Ficha em cancelado')
    $sql$
  ),
  '42501',
  'atendimento cancelado recusa ficha'
);

-- 4. Nao-compareceu segue recusado.
select is(
  pg_temp.h3_try(
    $sql$
      insert into clinical_records (customer_id, appointment_id, clinical_notes)
      values ('a3333333-3333-4333-8333-333333333321', 'a4444444-4444-4444-8444-444444444454', 'Ficha em nao_compareceu')
    $sql$
  ),
  '42501',
  'atendimento nao_compareceu recusa ficha'
);

-- 5. Recepção segue sem escrita clínica, mesmo em pendente.
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000012', 'authenticated');
select is(
  pg_temp.h3_try(
    $sql$
      insert into clinical_records (customer_id, appointment_id, clinical_notes)
      values ('a3333333-3333-4333-8333-333333333321', 'a4444444-4444-4444-8444-444444444451', 'Recepcao em pendente')
    $sql$
  ),
  '42501',
  'recepcao nao insere ficha em atendimento pendente'
);

-- 6. Cross-tenant segue negado.
reset role;
select tests.authenticate_as('b0000000-0000-4000-8000-000000000011', 'authenticated');
select is(
  pg_temp.h3_try(
    $sql$
      insert into clinical_records (customer_id, appointment_id, clinical_notes)
      values ('a3333333-3333-4333-8333-333333333321', 'a4444444-4444-4444-8444-444444444451', 'Cross-tenant em pendente')
    $sql$
  ),
  '42501',
  'admin de outro tenant nao insere ficha'
);

-- 7. Profissional insere no próprio atendimento pendente.
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000013', 'authenticated');
select lives_ok(
  $sql$
    insert into clinical_records (customer_id, appointment_id, clinical_notes)
    values ('a3333333-3333-4333-8333-333333333321', 'a4444444-4444-4444-8444-444444444456', 'Profissional em pendente proprio')
  $sql$,
  'profissional insere ficha no proprio atendimento pendente'
);

-- ============================================================================
-- RF-12: baixa automática com auto-vínculo ao concluir (sem package_credit_id).
-- ============================================================================
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');

-- 8. Concluir sem vínculo baixa 1 no mesmo commit.
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444455';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444455';
  end $inner$ $sql$,
  'concluir atendimento sem vinculo baixa 1 sessao no mesmo commit'
);
select is(
  (select used_sessions from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333321' and total_sessions = 5),
  1, 'used_sessions soma 1 no concluir sem vinculo'
);
-- 10. O vínculo é gravado no atendimento (auditoria de qual crédito consumiu).
select is(
  (select package_credit_id from appointments where id = 'a4444444-4444-4444-8444-444444444455'),
  (select id from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333321' and total_sessions = 5),
  'concluir sem vinculo preenche package_credit_id no atendimento'
);

-- 11. Segundo concluir usa o mesmo crédito (FIFO, ainda há saldo).
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444456';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444456';
  end $inner$ $sql$,
  'segundo concluir sem vinculo consome do mesmo credito'
);
select is(
  (select used_sessions from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333321' and total_sessions = 5),
  2, 'used_sessions soma 2 apos dois concluir'
);

-- 12-14. Serviço sem crédito: concluir segue avulso (não falha, não vincula, não consome).
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444457';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444457';
  end $inner$ $sql$,
  'concluir servico sem credito nao falha (avulso)'
);
select is(
  (select used_sessions from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333321' and total_sessions = 5),
  2, 'avulso nao consome credito de outro servico'
);
select is(
  (select package_credit_id from appointments where id = 'a4444444-4444-4444-8444-444444444457'),
  null, 'avulso mantem package_credit_id nulo'
);

-- 15-17. Cancelado com crédito ativo: não consome e não vincula.
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set status = 'cancelado' where id = 'a4444444-4444-4444-8444-444444444458';
  end $inner$ $sql$,
  'cancelar atendimento com credito ativo nao mexe no credito'
);
select is(
  (select used_sessions from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333321' and total_sessions = 5),
  2, 'used_sessions inalterado apos cancelado'
);
select is(
  (select package_credit_id from appointments where id = 'a4444444-4444-4444-8444-444444444458'),
  null, 'cancelado nao preenche package_credit_id'
);

-- 18-20. Só crédito vencido: concluir não falha (avulso), sem consumo e sem
-- vínculo. Cliente dedicado (A2) cujo ÚNICO crédito está vencido: prova que o
-- auto-vínculo ignora vencido em vez de consumir ou de abortar o concluir.
select lives_ok(
  $$ select sell_package('a3333333-3333-4333-8333-333333333322', 'a2222222-2222-4222-8222-222222222221', 1, 12000, 30) $$,
  'H3 setup: pacote de 1 sessao para vencer (cliente dedicado)'
);
reset role;
update package_credits set expires_at = now() - interval '1 day'
  where customer_id = 'a3333333-3333-4333-8333-333333333322' and total_sessions = 1;
reset role;
select tests.authenticate_as('a0000000-0000-4000-8000-000000000011', 'authenticated');
select lives_ok(
  $sql$ DO $inner$ begin
    update appointments set status = 'em_atendimento' where id = 'a4444444-4444-4444-8444-444444444459';
    update appointments set status = 'concluido' where id = 'a4444444-4444-4444-8444-444444444459';
  end $inner$ $sql$,
  'concluir com so credito vencido nao falha (avulso)'
);
select is(
  (select used_sessions from package_credits where customer_id = 'a3333333-3333-4333-8333-333333333322' and total_sessions = 1),
  0, 'vencido nao e consumido pelo auto-vinculo'
);
select is(
  (select package_credit_id from appointments where id = 'a4444444-4444-4444-8444-444444444459'),
  null, 'auto-vinculo ignora credito vencido'
);

reset role;
select * from finish();
rollback;
