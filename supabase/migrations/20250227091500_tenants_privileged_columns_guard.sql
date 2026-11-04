-- Migration: tenants_privileged_columns_guard (ADR-02, Fatia Super Admin — Opção A)
-- Fecha o BYPASS de escrita das colunas privilegiadas de `tenants` pelo cliente, preservando a
-- edição de cadastro pelo super_admin. Achado crítico da análise de dados (§1): a policy
-- `tenants_super_admin` (20250216091000) é FOR ALL — somada por OR às demais policies
-- permissivas, ela JÁ permite ao super_admin fazer UPDATE de QUALQUER coluna de QUALQUER tenant
-- pelo cliente (anon key + sessão), inclusive `subscription_status`, SEM validação de transição
-- e SEM trilha (R-11, R-12, CA-11, CA-12). Esse é exatamente o defeito que a Edge Function
-- (ADR-03) existe para eliminar: se o bypass continuar aberto, o caminho auditado conviveria com
-- um caminho não auditado.
--
-- GATE Q-01 = Opção A: fechar a escrita de `subscription_status`/`plan`/`trial_ends_at` pelo
-- cliente PRESERVANDO a edição de cadastro (`trade_name`, `legal_name`, `phone`, `document`,
-- `timezone`) pelo super_admin pelo cliente (não reabre a decisão ADR-03 do brain). A Opção B
-- (SELECT puro) tiraria também a edição de cadastro — desvio que o gate rejeitou.
--
-- GATE Q-02: o hardening `fix/seguranca-privilegios-profiles-tenants` NÃO está em master; esta
-- fatia parte de master e trata o estado atual como verdade. Os `drop ... if exists` tornam a
-- migration tolerante se um hotfix reduzir `tenants_super_admin` antes — alinhar os NOMES de
-- policy divergentes antes de aplicar, para o `supabase db reset` continuar limpo.
--
-- ISOLAMENTO MULTI-TENANT (RNF03, inegociável): após esta migration, a escrita das três colunas
-- privilegiadas pelo cliente passa a ser IMPOSSÍVEL para qualquer papel — trigger barra a sessão
-- `authenticated`; RLS (tenants_update_own_admin só alcança o próprio tenant) barra cross-tenant.
-- Resta SÓ o service role (Edge Function admin-subscription / RPC da ADR-01), que resolve o ator
-- pelo JWT no servidor. Nenhum `tenant_id` do corpo contorna RLS.
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); `trial_ends_at` é timestamptz (UTC). Os helpers
-- `current_role_name()` (security definer, 20250216091000) são reutilizados, não recriados. Nenhum
-- segredo no SQL. Idempotente no re-apply (drop policy if exists, create or replace function,
-- drop trigger if exists).

-- ============================================================================
-- 1. Reduzir a policy de super_admin de FOR ALL para SELECT.
--    Espelha a redução que a ADR-02 do brain fez em `profiles`: o super_admin continua LENDO
--    qualquer tenant pelo cliente (lista cross-tenant da Fatia 1), mas perde o UPDATE irrestrito
--    que vinha do FOR ALL. A edição de cadastro volta por uma policy de UPDATE dedicada (passo 2).
-- ============================================================================
drop policy if exists tenants_super_admin on public.tenants;
drop policy if exists tenants_super_admin_select on public.tenants;
create policy tenants_super_admin_select on public.tenants for select
  using (current_role_name() = 'super_admin');

-- ============================================================================
-- 2. Recriar o UPDATE do super_admin (preserva a edição de cadastro pelo cliente — Opção A).
--    A policy libera o UPDATE; o trigger do passo 3 é quem barra especificamente as três colunas
--    privilegiadas. Assim `trade_name`/`legal_name`/`phone`/`document`/`timezone` continuam
--    editáveis pelo cliente, e `subscription_status`/`plan`/`trial_ends_at` não.
-- ============================================================================
drop policy if exists tenants_super_admin_update_cadastro on public.tenants;
create policy tenants_super_admin_update_cadastro on public.tenants for update
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

-- ============================================================================
-- 3. Trigger BEFORE UPDATE que barra a mudança das três colunas privilegiadas quando a sessão
--    NÃO é service role. Column-level GRANT "não combina bem com PostgREST" (nota em
--    20250226090000), por isso a restrição vira trigger.
--    - auth.role() = 'authenticated' → sessão do cliente (anon key + JWT de usuário): barra.
--    - service role (Edge Function / RPC da ADR-01) tem auth.role() diferente → o guard libera;
--      é o único caminho que muda status/plano/trial.
--    - defesa em profundidade: o `admin` do próprio tenant já não alcança outro tenant (RLS);
--      o guard trava qualquer sessão `authenticated` que tente mexer nas três colunas.
-- ============================================================================
create or replace function public.tenants_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.role() = 'authenticated' then
    if new.subscription_status is distinct from old.subscription_status
       or new.plan is distinct from old.plan
       or new.trial_ends_at is distinct from old.trial_ends_at then
      raise exception 'privileged_column_change_denied'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.tenants_guard_privileged_columns() is
  'Barra a escrita de tenants.subscription_status/plan/trial_ends_at por sessao do cliente '
  '(auth.role() = authenticated), deixando essas colunas como exclusivas do service role '
  '(Edge Function admin-subscription / RPC admin_set_subscription_status). Fecha o bypass de '
  'escrita privilegiada pelo cliente (ADR-02 Super Admin, Opcao A, R-11/R-12/CA-11). Edicao de '
  'cadastro (trade_name/legal_name/phone/document/timezone) segue permitida. Nenhum segredo.';

-- Trigger em BEFORE UPDATE da linha inteira (não `of coluna`): precisa comparar OLD/NEW das três
-- colunas privilegiadas em qualquer UPDATE, inclusive quando elas vêm no SET junto de cadastro.
drop trigger if exists tenants_guard_privileged_columns_trg on public.tenants;
create trigger tenants_guard_privileged_columns_trg
  before update on public.tenants
  for each row
  execute function public.tenants_guard_privileged_columns();
