-- Teste de back-office T1.4/T1.5 (ADR-11 Fase 5), pgTAP.
--
-- Prova:
--   1. RPCs super-admin-only: não-super-admin recebe PT403; anon sem EXECUTE.
--   2. `backoffice_subscriptions()` devolve assinatura membership cross-tenant com
--      inadimplência (contagem/valor vencido) — cross-tenant só no back-office.
--   3. `mrr_report()` é SaaS atual (`kind=saas`) e `membership_mrr_churn()` é
--      membership (`kind=membership`): métricas separadas, nunca somadas (PRD §10.14).
--   4. Churn = canceladas no período (audit) / base de início; MRR exclui cancelada.
--      Métricas medidas por DELTA contra um baseline: o banco pode estar semeado.
--   5. `nfce_volume()` conta autorizadas/contingência/rejeitadas por período (delta).
--   6. Suspender/retomar: escrita de `subscription_status` pelo cliente é negada
--      (guard), e o caminho auditado grava autor + motivo em
--      `subscription_status_changes` (leitura RLS só super_admin).
--
-- Fixture própria, domínio `.invalido` (guarda do harness). Roda numa transação e
-- dá rollback: nada persiste.

create extension if not exists pgtap with schema extensions;
begin;
select plan(39);

-- Helper local: SQLSTATE do erro de um statement, ou 'ok'.
create or replace function pg_temp.bo_try(stmt text)
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
-- Baseline (owner, antes da fixture): churn/MRR e NFCe são medidos por DELTA.
-- Guardar em GUC de sessão `bo.*` porque as asserções rodam como `authenticated`
-- (RLS zeraria leituras diretas). Nunca em absoluto: o banco pode estar semeado.
-- ----------------------------------------------------------------------------
select set_config('bo.base_mrr_ativa', (
  select coalesce(sum(
           case p.billing_period
             when 'mensal'     then p.amount_cents::numeric
             when 'trimestral' then p.amount_cents::numeric / 3
             when 'anual'      then p.amount_cents::numeric / 12
             else 0
           end
         ), 0)::bigint::text
    from public.membership_subscriptions s
    join public.membership_plans p
      on p.tenant_id = s.tenant_id and p.id = s.plan_id
   where s.status = 'ativa'
), false);

select set_config('bo.base_inadimplentes', (
  select count(*)::int::text from public.membership_subscriptions
   where status = 'inadimplente'
), false);

select set_config('bo.base_nfce_autorizadas', (
  select count(*)::int::text from public.fiscal_documents f
   where f.created_at >= (current_date - 1)::timestamptz
     and f.created_at < (current_date + 1)::timestamptz
     and f.status = 'autorizada'
), false);

select set_config('bo.base_nfce_contingencia', (
  select count(*)::int::text from public.fiscal_documents f
   where f.created_at >= (current_date - 1)::timestamptz
     and f.created_at < (current_date + 1)::timestamptz
     and f.status = 'contingencia'
), false);

select set_config('bo.base_nfce_rejeitadas', (
  select count(*)::int::text from public.fiscal_documents f
   where f.created_at >= (current_date - 1)::timestamptz
     and f.created_at < (current_date + 1)::timestamptz
     and f.status = 'rejeitada'
), false);

select set_config('bo.base_nfce_valor', (
  select coalesce(sum(f.valor_cents), 0)::bigint::text
    from public.fiscal_documents f
   where f.created_at >= (current_date - 1)::timestamptz
     and f.created_at < (current_date + 1)::timestamptz
     and f.status = 'autorizada'
), false);

-- ----------------------------------------------------------------------------
-- Fixture: tenant A (admin + super admin/user), tenant B (admin).
-- Em banco semeado pode haver operador ativo; o trigger de freeze só libera o
-- PRIMEIRO super_admin com `internal_operators` vazia (padrão
-- 44-internal-operators-freeze). A limpeza é segura: a transação dá rollback.
-- ----------------------------------------------------------------------------
delete from public.internal_operators;

select tests.create_user('c1000000-0000-4000-8000-000000000011', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'Admin A');
select tests.create_user('c1000000-0000-4000-8000-000000000012', 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin', 'Admin B');
select tests.create_user('c1000000-0000-4000-8000-000000000013', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'super_admin', 'Operador Interno');

insert into public.internal_operators (user_id)
values ('c1000000-0000-4000-8000-000000000013')
on conflict do nothing;

-- Tenant A ativo no plano starter (SaaS MRR), tenant B em trial.
update public.tenants set subscription_status = 'ativo' where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.tenants set subscription_status = 'trial' where id = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

-- Membership do tenant A: cliente + plano mensal + assinatura ativa criada há 60 dias.
insert into public.customers (id, tenant_id, name, phone, whatsapp_opt_in)
values ('c3333333-3333-4333-8333-333333333311', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Backoffice', '+5511900000011', false);

insert into public.membership_plans (id, tenant_id, name, amount_cents, billing_period, active)
values ('c5555555-5555-4555-8555-555555555551', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mensal Backoffice', 9900, 'mensal', true);

insert into public.membership_subscriptions (id, tenant_id, customer_id, plan_id, status, created_at)
values (
  'c6666666-6666-4666-8666-666666666661',
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c3333333-3333-4333-8333-333333333311',
  'c5555555-5555-4555-8555-555555555551',
  'ativa',
  now() - interval '60 days'
);

-- Cobrança vencida do ciclo (inadimplência destacada na aba Operação).
insert into public.membership_charges (tenant_id, subscription_id, cycle_ref, amount_cents, status, due_at)
values ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c6666666-6666-4666-8666-666666666661', '2030-01', 9900, 'vencido', now() - interval '5 days');

-- NFCe do período: 2 autorizadas, 1 contingência, 1 rejeitada.
insert into public.fiscal_documents
  (tenant_id, origem_tipo, origem_id, numero, serie, chave_acesso, status, valor_cents, xml, authorized_at)
values
  ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sale', 'c7777777-7777-4777-8777-777777777771', '1', '1', '35200111111111111111111111111111111111111111', 'autorizada', 10000, '<xml/>', now()),
  ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sale', 'c7777777-7777-4777-8777-777777777772', '2', '1', '35200111111111111111111111111111111111111112', 'autorizada', 20000, '<xml/>', now()),
  ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sale', 'c7777777-7777-4777-8777-777777777773', '3', '1', null, 'contingencia', 5000, null, null),
  ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sale', 'c7777777-7777-4777-8777-777777777774', '4', '1', null, 'rejeitada', 7000, null, null);

-- ----------------------------------------------------------------------------
-- 1. Catálogo: funções existem; anon sem EXECUTE; authenticated com EXECUTE.
-- ----------------------------------------------------------------------------
select has_function('public', 'backoffice_subscriptions', 'RPC backoffice_subscriptions existe');
select has_function('public', 'mrr_report', 'RPC mrr_report existe');
select has_function('public', 'membership_mrr_churn', 'RPC membership_mrr_churn existe');
select has_function('public', 'nfce_volume', 'RPC nfce_volume existe');

select ok(
  not has_function_privilege('anon', 'public.backoffice_subscriptions()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mrr_report()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.membership_mrr_churn(date, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.nfce_volume(date, date)', 'EXECUTE'),
  'anon sem EXECUTE nas 4 RPCs do back-office'
);

select ok(
  has_function_privilege('authenticated', 'public.backoffice_subscriptions()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.mrr_report()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.membership_mrr_churn(date, date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.nfce_volume(date, date)', 'EXECUTE'),
  'authenticated tem EXECUTE (guard interno decide o papel)'
);

-- ----------------------------------------------------------------------------
-- 2. Guard: admin de tenant (não-super-admin) recebe PT403 nas 4 RPCs.
-- ----------------------------------------------------------------------------
select tests.authenticate_as('c1000000-0000-4000-8000-000000000011', 'authenticated');
select is(
  pg_temp.bo_try($$ select * from public.backoffice_subscriptions() $$),
  'PT403', 'admin nao acessa assinaturas cross-tenant (PT403)'
);
select is(
  pg_temp.bo_try($$ select public.mrr_report() $$),
  'PT403', 'admin nao le MRR SaaS (PT403)'
);
select is(
  pg_temp.bo_try($$ select public.membership_mrr_churn('2030-01-01', '2030-01-31') $$),
  'PT403', 'admin nao le MRR/churn membership (PT403)'
);
select is(
  pg_temp.bo_try($$ select public.nfce_volume('2030-01-01', '2030-01-31') $$),
  'PT403', 'admin nao le volume NFCe (PT403)'
);

-- ----------------------------------------------------------------------------
-- 3. Super admin: assinaturas cross-tenant + inadimplência.
-- ----------------------------------------------------------------------------
reset role;
select tests.authenticate_as('c1000000-0000-4000-8000-000000000013', 'authenticated');

select is(
  (select count(*) from public.backoffice_subscriptions() where tenant_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1::bigint, 'super admin ve a assinatura membership do tenant A'
);
select is(
  (select tenant_name from public.backoffice_subscriptions() where subscription_id = 'c6666666-6666-4666-8666-666666666661'),
  'Empresa de teste caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'linha traz o nome da empresa'
);
select is(
  (select overdue_charges from public.backoffice_subscriptions() where subscription_id = 'c6666666-6666-4666-8666-666666666661'),
  1, 'inadimplencia: 1 cobranca vencida'
);
select is(
  (select overdue_amount_cents from public.backoffice_subscriptions() where subscription_id = 'c6666666-6666-4666-8666-666666666661'),
  9900::bigint, 'inadimplencia: valor vencido em centavos'
);
select is(
  (select plan_name from public.backoffice_subscriptions() where subscription_id = 'c6666666-6666-4666-8666-666666666661'),
  'Mensal Backoffice', 'plano do cliente final na linha'
);

-- ----------------------------------------------------------------------------
-- 4. Métricas separadas: SaaS != membership, nunca somadas.
-- ----------------------------------------------------------------------------
select is(
  (select public.mrr_report()->>'kind'),
  'saas', 'mrr_report e SaaS (kind=saas)'
);
select is(
  (select (public.mrr_report()->>'mrr_cents')::bigint),
  (select coalesce(sum(public.plan_price_cents(t.plan))::bigint, 0)
     from public.tenants t where t.subscription_status = 'ativo'),
  'MRR SaaS = soma dos tenants ativos x preco do plano'
);
select is(
  (select public.membership_mrr_churn('2030-01-01', '2030-01-31')->>'kind'),
  'membership', 'membership_mrr_churn e membership (kind=membership)'
);
select is(
  (select (public.membership_mrr_churn('2030-01-01', '2030-01-31')->>'mrr_cents')::bigint)
    - current_setting('bo.base_mrr_ativa')::bigint,
  9900::bigint, 'MRR membership mensal normalizado: delta de 9900 da fixture'
);
select ok(
  (select (public.mrr_report()->>'mrr_cents')::bigint)
    <> (select (public.membership_mrr_churn('2030-01-01', '2030-01-31')->>'mrr_cents')::bigint),
  'MRR SaaS e MRR membership sao valores independentes (nunca somados)'
);
select is(
  (select (public.membership_mrr_churn('2030-01-01', '2030-01-31')->>'inadimplentes')::int)
    - current_setting('bo.base_inadimplentes')::int,
  0, 'assinatura ativa nao conta como inadimplente (delta zero vs baseline)'
);

-- ----------------------------------------------------------------------------
-- 5. Churn: cancelamento auditado no periodo; MRR deixa de contar a cancelada.
--    Medição por DELTA (GUC de sessão `bo.*`): o banco pode estar semeado e já
--    ter cancelamentos hoje.
-- ----------------------------------------------------------------------------
select set_config(
  'bo.churn_antes_canceladas',
  public.membership_mrr_churn(current_date - 1, current_date)->>'canceladas_periodo',
  false
);
select set_config(
  'bo.churn_antes_mrr',
  public.membership_mrr_churn(current_date - 1, current_date)->>'mrr_cents',
  false
);

reset role;
select tests.authenticate_as('c1000000-0000-4000-8000-000000000011', 'authenticated');
select lives_ok(
  $$ select public.membership_update_status('c6666666-6666-4666-8666-666666666661', 'cancelada', 'cliente pediu encerramento') $$,
  'admin do tenant cancela a assinatura (grava auditoria)'
);
reset role;
select tests.authenticate_as('c1000000-0000-4000-8000-000000000013', 'authenticated');
select is(
  (select (public.membership_mrr_churn(current_date - 1, current_date)->>'canceladas_periodo')::int),
  current_setting('bo.churn_antes_canceladas')::int + 1,
  'churn conta +1 cancelada dentro do periodo'
);
select is(
  (select (public.membership_mrr_churn(current_date - 1, current_date)->>'mrr_cents')::bigint),
  current_setting('bo.churn_antes_mrr')::bigint - 9900,
  'cancelada sai do MRR membership (delta -9900)'
);
select cmp_ok(
  (select (public.membership_mrr_churn(current_date - 1, current_date)->>'base_inicio')::int),
  '>=', 1, 'base de inicio conta assinatura existente antes do periodo'
);

-- ----------------------------------------------------------------------------
-- 6. Volume NFCe por período.
-- ----------------------------------------------------------------------------
select is(
  (select public.nfce_volume('2030-01-01', '2030-01-31')->>'kind'),
  'nfce', 'nfce_volume tem kind=nfce'
);
select is(
  (select (public.nfce_volume(current_date - 1, current_date)->>'autorizadas')::int)
    - current_setting('bo.base_nfce_autorizadas')::int,
  2, 'NFCe autorizadas no periodo (delta da fixture)'
);
select is(
  (select (public.nfce_volume(current_date - 1, current_date)->>'contingencia')::int)
    - current_setting('bo.base_nfce_contingencia')::int,
  1, 'NFCe contingencia no periodo (delta da fixture)'
);
select is(
  (select (public.nfce_volume(current_date - 1, current_date)->>'rejeitadas')::int)
    - current_setting('bo.base_nfce_rejeitadas')::int,
  1, 'NFCe rejeitadas no periodo (delta da fixture)'
);
select is(
  (select (public.nfce_volume(current_date - 1, current_date)->>'valor_autorizado_cents')::bigint)
    - current_setting('bo.base_nfce_valor')::bigint,
  30000::bigint, 'valor autorizado soma apenas autorizadas (delta 2x da fixture)'
);
select is(
  pg_temp.bo_try($$ select public.nfce_volume('2030-02-01', '2030-01-01') $$),
  'PT400', 'periodo invertido e rejeitado (PT400)'
);

-- ----------------------------------------------------------------------------
-- 7. Suspender/retomar auditado (autor + motivo) e RLS da trilha.
-- ----------------------------------------------------------------------------
-- Escrita privilegiada pelo cliente é barrada mesmo para super_admin (guard).
reset role;
select tests.authenticate_as('c1000000-0000-4000-8000-000000000013', 'authenticated');
select is(
  pg_temp.bo_try($$ update public.tenants set subscription_status = 'cancelado' where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$),
  '42501', 'cliente nao escreve subscription_status direto (só caminho auditado)'
);

-- Caminho auditado (service role/RPC): suspender e retomar com motivo.
-- Sem claims de usuário: `auth.role()` deixa de ser `authenticated`, como na
-- chamada da Edge Function com service role (o guard barra só a sessão do cliente).
reset role;
select tests.clear_authentication();
select lives_ok(
  $$ select public.admin_set_subscription_status('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bloqueado', 'c1000000-0000-4000-8000-000000000013', 'inadimplencia confirmada pelo financeiro') $$,
  'suspender tenant grava status + trilha atomicamente'
);
select is(
  (select subscription_status from public.tenants where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'bloqueado', 'tenant suspenso fica bloqueado (app redireciona quitacao)'
);
select lives_ok(
  $$ select public.admin_set_subscription_status('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ativo', 'c1000000-0000-4000-8000-000000000013', 'pagamento confirmado') $$,
  'retomar tenant grava status + trilha atomicamente'
);
select is(
  (select subscription_status from public.tenants where id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'ativo', 'retomar volta o tenant para ativo'
);

-- Leitura da trilha: super_admin vê autor + motivo; admin de outro tenant não vê.
select tests.authenticate_as('c1000000-0000-4000-8000-000000000013', 'authenticated');
select is(
  (select count(*) from public.subscription_status_changes
    where tenant_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and changed_by = 'c1000000-0000-4000-8000-000000000013'
      and new_status = 'bloqueado'
      and reason = 'inadimplencia confirmada pelo financeiro'),
  1::bigint, 'suspensao auditada com autor e motivo (super_admin le)'
);
select is(
  (select count(*) from public.subscription_status_changes where tenant_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2::bigint, 'suspender + retomar = 2 linhas de trilha'
);

reset role;
select tests.authenticate_as('c1000000-0000-4000-8000-000000000012', 'authenticated');
select is(
  (select count(*) from public.subscription_status_changes),
  0::bigint, 'admin de outro tenant nao le a trilha (RLS nega)'
);

select * from finish();
