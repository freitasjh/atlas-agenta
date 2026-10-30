-- Migration: profiles_password_gate (ADR-01, acesso inicial do super admin)
-- Cria o flag server-controlled de troca obrigatória de senha em `profiles` e o helper
-- `current_must_change_password()` usado pelas policies de leitura cross-tenant (ADR-03).
--
-- Por que coluna em `profiles` e não em `user_metadata`: o usuário altera o próprio
-- `user_metadata`, o que anularia a proteção (PRD P10).
--
-- Esta migration é aditiva. Não altera policies nem trigger; a proteção de escrita do cliente
-- sobre as colunas é a ADR-02, e o bloqueio das policies é a ADR-03. Até a ADR-02, a coluna é
-- gravável pelo cliente, o que não gera brecha porque nenhum código lê o flag antes da ADR-04.
--
-- Convenções: nenhum dinheiro aqui; `password_changed_at` é timestamptz (UTC). Nenhum segredo.
-- Idempotente no re-apply (add column if not exists, create or replace function).

-- 1. Flag de troca obrigatória. Perfis existentes ficam com false, sem backfill manual.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- 2. Data em que a troca obrigatória foi concluída (nula até a troca).
alter table public.profiles
  add column if not exists password_changed_at timestamptz;

-- 3. Helper security definer, mesmo padrão de current_role_name(). Evita recursão de RLS ao
--    ser chamado dentro de policies. Sem linha para o auth.uid(), retorna false.
create or replace function public.current_must_change_password()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select must_change_password from public.profiles where id = auth.uid()),
    false
  )
$$;

comment on function public.current_must_change_password() is
  'Retorna true enquanto o usuario da sessao precisa trocar a senha provisoria (ADR-01 '
  'Super Admin). Usado pelas policies de leitura cross-tenant. Security definer para evitar '
  'recursao de RLS.';

-- 4. Permissões: execução só para a sessão autenticada. As policies rodam como o usuário da
--    sessão, então anon e PUBLIC não precisam chamar a função.
revoke all on function public.current_must_change_password() from public, anon;
grant execute on function public.current_must_change_password() to authenticated;
