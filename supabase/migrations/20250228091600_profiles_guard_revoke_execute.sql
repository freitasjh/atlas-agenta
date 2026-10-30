-- Migration: profiles_guard_revoke_execute (ADR-02, correção de revisão)
-- A função trigger profiles_guard_privileged_columns() (20250228091500) ficou com EXECUTE para
-- public, anon e authenticated. Função trigger não é chamável como RPC, mas o advisor de segurança
-- do Supabase sinaliza a exposição. Esta migration revoga o EXECUTE (menor privilégio).
-- O trigger continua disparando: o Postgres checa EXECUTE só na criação do trigger, não no disparo.
-- A migration original não é editada, porque já foi aplicada.

revoke execute on function public.profiles_guard_privileged_columns()
  from public, anon, authenticated;
