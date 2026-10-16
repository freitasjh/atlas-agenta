-- Migration: signup atômico server-side (ADR-04)
-- Fecha o bloco de dados da fase: no cadastro de uma nova empresa, `auth.users` (criado pelo
-- Supabase Auth no signUp), `tenants` (nova, em trial) e `profiles` (role='admin' ligando os
-- dois) precisam nascer juntos. Fazer isso em passos no cliente deixaria uma janela de profile
-- órfão e esbarraria no RLS — não há policy de INSERT ao cliente em tenants/profiles (decisão
-- de segurança da ADR-03). O cliente também NUNCA escolhe o próprio `role` nem aponta
-- `tenant_id`: isso é decisão do servidor (fronteira 6 do PRD / seguranca-multitenant.md).
--
-- Abordagem (analysis-data A4.5): trigger `after insert on auth.users` executando uma função
-- `security definer` que cria o tenant + o profile admin atomicamente, lendo os metadados de
-- `raw_user_meta_data` passados no signUp. Como roda sob a transação do insert em auth.users,
-- se a função falhar o usuário não é criado (sem órfão).
--
-- Ordem das migrations de dados desta fase: 02 (tenants) -> 03 (profiles + helpers + policies)
-- -> 04 (este trigger). A função roda como definer, fora do RLS do chamador, por isso insere
-- sem precisar de policy de INSERT.
--
-- Contrato com o frontend (ADR-06/07): o `useSignUp` chama `supabase.auth.signUp` passando
-- `options.data = { trade_name, full_name? }`. As chaves lidas aqui (`trade_name`, `full_name`)
-- DEVEM bater exatamente com as que o cliente envia; divergir cria tenant com nome errado/nulo.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); todo tempo é timestamptz (UTC).

-- Função que cria tenant + profile admin no cadastro de nova empresa.
-- security definer + search_path fixo: insere sob os privilégios do owner (fora do RLS do
-- cliente) e evita injeção por search_path.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  -- Cria a empresa nova em trial (14 dias — Q1 confirmado pelo humano em prd-approval.json).
  -- legal_name é obrigatório: cai para trade_name, depois para o e-mail, se não vier nada.
  insert into tenants (legal_name, trade_name, owner_email, plan, subscription_status, trial_ends_at)
  values (
    coalesce(
      new.raw_user_meta_data->>'trade_name',
      new.raw_user_meta_data->>'legal_name',
      new.email
    ),
    new.raw_user_meta_data->>'trade_name',
    new.email,
    'individual',
    'trial',
    now() + interval '14 days'
  )
  returning id into v_tenant_id;

  -- Liga o usuário recém-criado ao tenant como admin. O `role` é SEMPRE 'admin' de uma empresa
  -- NOVA; nunca lido do payload do cliente. Convite de membros (professional/receptionist em
  -- tenant existente) não faz parte desta fase.
  insert into profiles (id, tenant_id, role, full_name)
  values (new.id, v_tenant_id, 'admin', new.raw_user_meta_data->>'full_name');

  return new;
end;
$$;

-- Trigger: dispara a função após cada novo usuário de auth. Idempotente no re-apply via
-- `drop ... if exists`.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
