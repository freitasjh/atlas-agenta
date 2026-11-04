-- Prova da ADR-04: nenhum role de aplicação executa TRUNCATE em public (PRD RF-08 a RF-10).
--
-- anon, authenticated e service_role não têm TRUNCATE nas 17 tabelas de domínio (RF-08). O owner
-- (postgres) mantém o privilégio para manutenção (RF-09). Tabela nova criada pelo owner nasce sem
-- TRUNCATE para os três roles, graças ao ALTER DEFAULT PRIVILEGES (RF-10).
--
-- Os negativos rodam com o papel real (`set local role`). service_role entra por `set local role`
-- direto, porque tests.authenticate_as aceita só anon e authenticated. A tabela de prova não tem
-- chave estrangeira: truncar tabela real com FK sem cascade falharia, e com cascade apagaria
-- fixtures de outros testes. Tudo fica numa transação com rollback.
create extension if not exists pgtap with schema extensions;

begin;

select plan(7);

-- Lista das 17 tabelas de domínio (PRD §2.1). Temporária, só para o teste.
create temp table tabelas_dominio (nome text primary key);
insert into tabelas_dominio (nome) values
  ('appointment_commissions'),
  ('appointments'),
  ('combo_services'),
  ('combos'),
  ('customers'),
  ('message_templates'),
  ('messages'),
  ('professional_commissions'),
  ('professionals'),
  ('profiles'),
  ('schedule_overrides'),
  ('service_professionals'),
  ('services'),
  ('tenants'),
  ('webhook_events'),
  ('whatsapp_instances'),
  ('working_hours');

-- Precondição: as 17 tabelas existem em public. Sem isso, os testes abaixo passariam por ausência.
select is(
  (select count(*) from pg_tables p join tabelas_dominio t on t.nome = p.tablename where p.schemaname = 'public'),
  17::bigint,
  'precondição: as 17 tabelas de domínio existem em public'
);

-- AC-13 (RF-08): catálogo. Nenhum role de aplicação tem TRUNCATE em nenhuma das 17 tabelas.
-- A consulta devolve as falhas; o esperado é vazio.
select is_empty(
  $$select t.nome, r.papel
      from tabelas_dominio t
      cross join (values ('anon'), ('authenticated'), ('service_role')) as r(papel)
     where has_table_privilege(r.papel, 'public.' || t.nome, 'TRUNCATE')$$,
  'AC-13: anon, authenticated e service_role sem TRUNCATE nas 17 tabelas (catálogo)'
);

-- AC-14 (RF-08): execução real. Cada role tenta TRUNCATE em cada tabela. O esperado é 42501.
-- Qualquer outro resultado (inclusive sucesso) vai para a tabela de falhas.
create temp table truncate_falhas (papel text, tabela text, codigo text);

do $body$
declare
  v_papel  text;
  v_tabela text;
  v_codigo text;
begin
  for v_papel in select unnest(array['anon', 'authenticated', 'service_role']) loop
    for v_tabela in select nome from tabelas_dominio loop
      execute format('set local role %I', v_papel);
      begin
        execute format('truncate table public.%I', v_tabela);
        v_codigo := 'sem erro';
      exception
        when insufficient_privilege then
          v_codigo := '42501';
        when others then
          v_codigo := sqlstate;
      end;
      execute 'reset role';
      if v_codigo <> '42501' then
        insert into truncate_falhas (papel, tabela, codigo) values (v_papel, v_tabela, v_codigo);
      end if;
    end loop;
  end loop;
end
$body$;

select is_empty(
  'select papel, tabela, codigo from truncate_falhas',
  'AC-14: anon, authenticated e service_role recebem 42501 ao tentar TRUNCATE em cada uma das 17 tabelas'
);

-- AC-15 (RF-10): tabela criada pelo owner dentro do teste nasce sem TRUNCATE para os três roles.
create table public.tabela_prova_truncate (id integer primary key);

select ok(
  not has_table_privilege('anon', 'public.tabela_prova_truncate', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.tabela_prova_truncate', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.tabela_prova_truncate', 'TRUNCATE'),
  'AC-15: tabela nova do owner sem TRUNCATE para anon, authenticated e service_role'
);

-- AC-16 (RF-09): o owner executa TRUNCATE na tabela de prova e ela fica vazia.
insert into public.tabela_prova_truncate (id) values (1), (2);

select lives_ok(
  'truncate table public.tabela_prova_truncate',
  'AC-16: owner (postgres) executa TRUNCATE em tabela de prova'
);

select is(
  (select count(*) from public.tabela_prova_truncate),
  0::bigint,
  'AC-16: TRUNCATE do owner esvazia a tabela de prova'
);

-- RF-09: o owner mantém TRUNCATE nas 17 tabelas de domínio (manutenção não quebra).
select is_empty(
  $$select t.nome from tabelas_dominio t where not has_table_privilege(current_user, 'public.' || t.nome, 'TRUNCATE')$$,
  'RF-09: owner mantém TRUNCATE nas 17 tabelas de domínio'
);

select * from finish();

rollback;
