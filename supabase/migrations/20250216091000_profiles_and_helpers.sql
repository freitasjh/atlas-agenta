-- Migration: profiles + helpers security definer + policies de RLS (ADR-03)
-- Coração do isolamento multi-tenant (RNF03, inegociável): a tabela `profiles` que liga
-- auth.users -> tenant + papel, as funções `current_tenant_id()` / `current_role_name()`
-- (security definer) que toda policy consulta, e as policies USING + WITH CHECK que
-- materializam "a empresa A nunca vê dado da empresa B".
--
-- Ordem obrigatória (PRD §9): função security definer ANTES das policies que a chamam.
-- Por isso esta migration cria as funções e só então aplica as policies — tanto as de
-- `profiles` quanto as de `tenants` que a ADR-02 deixou pendentes.
--
-- Armadilha central (skill supabase-multitenant, analysis-data A4.3): a policy de
-- `profiles` precisa do tenant_id do usuário, o que exigiria ler `profiles` dentro da
-- própria policy de `profiles` -> recursão de RLS. A quebra é ler via função
-- `security definer` com `search_path` fixo, que roda fora do RLS do chamador.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); todo tempo é timestamptz (UTC). Os
-- literais de `role` espelham exatamente ROLES em src/types/domain.ts — não divergir.

-- 1. Tabela profiles (analysis-data A4.3).
create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  tenant_id   uuid references tenants (id) on delete cascade,  -- null: super_admin pode não ter tenant
  role        text not null
              check (role in ('super_admin','admin','professional','receptionist')),
  full_name   text,
  created_at  timestamptz not null default now(),
  -- Invariante de domínio no banco: só super_admin pode ter tenant_id nulo.
  constraint profiles_tenant_required_for_non_super
    check (role = 'super_admin' or tenant_id is not null)
);

-- 2. Índice por tenant_id (particionamento lógico multi-tenant).
create index if not exists profiles_tenant_id_idx on profiles (tenant_id);

-- 3. Funções helper. security definer + search_path fixo quebra a recursão de RLS com
--    segurança e impede injeção por search_path. stable: resultado constante na transação.
create or replace function current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from profiles where id = auth.uid()
$$;

create or replace function current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- 4. RLS habilitado em profiles.
alter table profiles enable row level security;

-- 5. Policies de profiles (analysis-data A4.4). Sem policy de INSERT aberta ao cliente:
--    o insert de profiles vem do trigger security definer da ADR-04.
drop policy if exists profiles_select_same_tenant on profiles;
create policy profiles_select_same_tenant on profiles for select
  using (
    id = auth.uid()
    or (tenant_id is not null and tenant_id = current_tenant_id())
  );

drop policy if exists profiles_update_self_or_admin on profiles;
create policy profiles_update_self_or_admin on profiles for update
  using (
    id = auth.uid()
    or (current_role_name() = 'admin' and tenant_id = current_tenant_id())
  )
  with check (
    tenant_id = current_tenant_id()
    or current_role_name() = 'super_admin'
  );

-- Caminho cross-tenant auditado do super_admin (nunca acidental).
drop policy if exists profiles_super_admin on profiles;
create policy profiles_super_admin on profiles for all
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

-- 6. Policies de tenants pendentes da ADR-02 (agora que as funções existem). Sem policy
--    de INSERT aberta ao cliente em tenants (insert vem do trigger da ADR-04).
drop policy if exists tenants_select_own on tenants;
create policy tenants_select_own on tenants for select
  using (id = current_tenant_id());

drop policy if exists tenants_update_own_admin on tenants;
create policy tenants_update_own_admin on tenants for update
  using (id = current_tenant_id() and current_role_name() = 'admin')
  with check (id = current_tenant_id() and current_role_name() = 'admin');

drop policy if exists tenants_super_admin on tenants;
create policy tenants_super_admin on tenants for all
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');
