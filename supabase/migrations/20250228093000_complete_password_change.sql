-- Migration: complete_password_change (ADR-05, Super Admin)
-- Cria a RPC que zera profiles.must_change_password e preenche password_changed_at. É o único
-- caminho de escrita do flag na troca de senha. A Edge Function change-password (ADR-08) chama
-- esta função com service role, depois de gravar a senha nova no Auth.
--
-- Regras:
-- - Idempotente: só altera a linha se o flag ainda está true. Chamada repetida retorna false e
--   não mexe em password_changed_at.
-- - Perfil inexistente retorna false.
-- - Execução só para service_role. Cliente (anon/authenticated) não zera o próprio flag.
-- - A escrita passa pelo guard profiles_guard_privileged_columns (ADR-02) sem bloqueio, porque
--   o guard só barra auth.role() = 'authenticated'. Esta função é security definer e roda como
--   dono da função, então auth.role() é 'service_role' quando chamada pela Edge.
-- Nenhum dado de tenant é lido ou escrito. Nenhum segredo.

create or replace function public.complete_password_change(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.profiles
     set must_change_password = false,
         password_changed_at = now()
   where id = p_user_id
     and must_change_password = true;

  return found;
end;
$$;

comment on function public.complete_password_change(uuid) is
  'Zera profiles.must_change_password e grava password_changed_at para o usuario informado. '
  'Retorna true se alterou uma linha, false se o flag ja estava zerado ou o perfil nao existe. '
  'Executavel somente por service_role (ADR-05 Super Admin).';

-- Permissões: menor privilégio. Nenhum papel de cliente executa a função.
revoke all on function public.complete_password_change(uuid) from public, anon, authenticated;
grant execute on function public.complete_password_change(uuid) to service_role;
