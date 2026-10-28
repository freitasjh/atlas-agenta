-- Teste de imutabilidade de clinical_records (ADR-07), pgTAP.
-- Prova: UPDATE, DELETE e TRUNCATE falham para owner (também em modo replica), authenticated e
-- service_role; o registro
-- original não muda; o insert de correção legítima por admin continua funcionando (regressão).
--
-- Papéis:
--   - authenticated: via tests.authenticate_as, com RLS real. Falha no grant (42501).
--   - owner: falha no trigger (23001). Grant não se aplica ao owner.
--   - service_role: a migration revoga o grant (falha 42501). Para provar que o TRIGGER também barra,
--     o teste re-concede update, delete e truncate a service_role dentro da transação. Assim a
--     recusa 23001 vem do trigger, não do grant. O rollback desfaz a concessão.
--
-- Fixture própria, domínio `.invalido` (guarda do harness, ADR-04). Roda numa transação e dá
-- rollback: nada persiste no banco de teste.

create extension if not exists pgtap with schema extensions;
begin;
select plan(17);

-- Helper local (pg_temp, some com a transação). Executa o statement e devolve o SQLSTATE do erro,
-- ou 'ok' se passou. Não compara mensagem: a mensagem é fixa e não tem dado.
create or replace function pg_temp.immutable_state(stmt text)
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
-- Fixture: tenant A (clínica, ativo), admin, cliente, profissional, serviço, atendimento concluído e
-- um registro original de autoria do admin. Inserido pelo owner.
-- ----------------------------------------------------------------------------
select tests.create_user('10000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');

update tenants set segment = 'clinica', plan = 'clinica', subscription_status = 'ativo'
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into professionals (id, tenant_id, name) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Profissional A');

insert into customers (id, tenant_id, name, phone) values
  ('a3333333-3333-4333-8333-333333333331', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente A1', '+5511900000001');

insert into services (id, tenant_id, name, duration_minutes, price_cents) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Consulta A', 60, 15000);

insert into appointments (id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status) values
  ('a4444444-4444-4444-8444-444444444441', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', '2030-03-10 10:00:00+00', '2030-03-10 11:00:00+00', 15000, 'concluido');

insert into clinical_records (id, tenant_id, customer_id, appointment_id, allergies, clinical_notes, created_by) values
  ('c5555555-5555-4555-8555-555555555501', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331', 'a4444444-4444-4444-8444-444444444441', 'Dipirona', 'Observação original', '10000000-0000-4000-8000-000000000001');

-- Foto do registro antes das tentativas, para comparar depois (critério 4).
create temp table clinical_records_snapshot on commit drop as
  select * from clinical_records where id = 'c5555555-5555-4555-8555-555555555501';

-- Trigger instalado nas duas formas (linha e statement).
select has_trigger('clinical_records', 'clinical_records_block_update_delete', 'trigger de linha de update e delete existe');
select has_trigger('clinical_records', 'clinical_records_block_truncate', 'trigger de truncate existe');

-- service_role sem UPDATE, DELETE e TRUNCATE no estado migrado (camada 1).
select ok(
  not has_table_privilege('service_role', 'public.clinical_records', 'UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.clinical_records', 'UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.clinical_records', 'UPDATE,DELETE,TRUNCATE'),
  'service_role, anon e authenticated sem UPDATE, DELETE e TRUNCATE após a migration'
);

-- ----------------------------------------------------------------------------
-- Owner (postgres): grant não se aplica, o trigger recusa com 23001.
-- ----------------------------------------------------------------------------
select is(
  pg_temp.immutable_state($sql$ update clinical_records set clinical_notes = 'Alterado' where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '23001',
  'owner não consegue UPDATE: trigger recusa com restrict_violation'
);

select is(
  pg_temp.immutable_state($sql$ delete from clinical_records where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '23001',
  'owner não consegue DELETE: trigger recusa com restrict_violation'
);

select is(
  pg_temp.immutable_state($sql$ truncate clinical_records $sql$),
  '23001',
  'owner não consegue TRUNCATE: trigger de statement recusa com restrict_violation'
);

-- Owner em modo replica: triggers habilitados como ENABLE ALWAYS disparam mesmo com
-- session_replication_role = replica (sem isso, o modo replica desligaria as camadas 2 e 3).
set session_replication_role = replica;

select is(
  pg_temp.immutable_state($sql$ update clinical_records set clinical_notes = 'Alterado' where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '23001',
  'owner em modo replica não consegue UPDATE: trigger always recusa com restrict_violation'
);

select is(
  pg_temp.immutable_state($sql$ delete from clinical_records where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '23001',
  'owner em modo replica não consegue DELETE: trigger always recusa com restrict_violation'
);

select is(
  pg_temp.immutable_state($sql$ truncate clinical_records $sql$),
  '23001',
  'owner em modo replica não consegue TRUNCATE: trigger always recusa com restrict_violation'
);

set session_replication_role = origin;

-- ----------------------------------------------------------------------------
-- authenticated (admin do tenant, RLS real): falta de grant, 42501.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('10000000-0000-4000-8000-000000000001', 'authenticated');

select is(
  pg_temp.immutable_state($sql$ update clinical_records set clinical_notes = 'Alterado' where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '42501',
  'authenticated não consegue UPDATE: falta de grant (insufficient_privilege)'
);

select is(
  pg_temp.immutable_state($sql$ delete from clinical_records where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '42501',
  'authenticated não consegue DELETE: falta de grant (insufficient_privilege)'
);

select is(
  pg_temp.immutable_state($sql$ truncate clinical_records $sql$),
  '42501',
  'authenticated não consegue TRUNCATE: falta de grant (insufficient_privilege)'
);

-- ----------------------------------------------------------------------------
-- service_role: re-concede os privilégios dentro da transação para provar que o TRIGGER barra.
-- ----------------------------------------------------------------------------
reset role;
grant update, delete, truncate on table clinical_records to service_role;
set local role service_role;

select is(
  pg_temp.immutable_state($sql$ update clinical_records set clinical_notes = 'Alterado' where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '23001',
  'service_role com grant ainda não consegue UPDATE: trigger recusa com restrict_violation'
);

select is(
  pg_temp.immutable_state($sql$ delete from clinical_records where id = 'c5555555-5555-4555-8555-555555555501' $sql$),
  '23001',
  'service_role com grant ainda não consegue DELETE: trigger recusa com restrict_violation'
);

select is(
  pg_temp.immutable_state($sql$ truncate clinical_records $sql$),
  '23001',
  'service_role com grant ainda não consegue TRUNCATE: trigger recusa com restrict_violation'
);

-- Volta ao owner e desfaz a concessão de teste (o rollback também desfaz).
reset role;
revoke update, delete, truncate on table clinical_records from service_role;

-- ----------------------------------------------------------------------------
-- Critério 4: depois de todas as tentativas, o registro está igual ao da foto.
-- ----------------------------------------------------------------------------
select results_eq(
  $$ select * from clinical_records where id = 'c5555555-5555-4555-8555-555555555501' $$,
  $$ select * from clinical_records_snapshot $$,
  'registro original não muda após todas as tentativas de UPDATE, DELETE e TRUNCATE'
);

-- ----------------------------------------------------------------------------
-- Critério 5 (regressão): correção legítima por admin continua funcionando (insert).
-- ----------------------------------------------------------------------------
select tests.authenticate_as('10000000-0000-4000-8000-000000000001', 'authenticated');

select lives_ok(
  $sql$
    insert into clinical_records (tenant_id, customer_id, appointment_id, supersedes_id, clinical_notes, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a3333333-3333-4333-8333-333333333331',
            'a4444444-4444-4444-8444-444444444441', 'c5555555-5555-4555-8555-555555555501',
            'Correção pelo admin', '10000000-0000-4000-8000-000000000001')
  $sql$,
  'admin registra correção legítima do original por insert, mesmo com a imutabilidade'
);

select * from finish();
rollback;
