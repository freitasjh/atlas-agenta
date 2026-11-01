-- Migration: profiles_guard_password_changed_at (ADR-02, correção de revisão)
-- A função guard profiles_guard_privileged_columns() (20250228091500) não protegia
-- `password_changed_at`. Um usuário autenticado conseguia alterar o próprio timestamp pelo
-- PostgREST, o que quebra a integridade do dado de auditoria da troca de senha (ADR-05).
-- Esta migration recria a função com a coluna incluída. O trigger
-- profiles_guard_privileged_columns_trg já aponta para a função pelo nome, então não precisa
-- ser recriado. As migrations 20250228091500 e 20250228091600 não são editadas, porque já foram
-- aplicadas.
-- Mesma regra da função original: só barra quando auth.role() = 'authenticated'. Service role,
-- postgres e security definer executado por eles continuam podendo gravar (ADR-05 e ADR-04).

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.tenant_id is distinct from old.tenant_id
       or new.must_change_password is distinct from old.must_change_password
       or new.password_changed_at is distinct from old.password_changed_at then
      raise exception 'privileged_column_change_denied'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.profiles_guard_privileged_columns() is
  'Barra a escrita de profiles.id/role/tenant_id/must_change_password/password_changed_at por '
  'sessao do cliente (auth.role() = authenticated). Essas colunas ficam restritas ao service role '
  'e a funcoes security definer executadas por ele (bootstrap, troca de senha). Fecha o '
  'escalonamento de privilegio em profiles (ADR-02 Super Admin). Edicao de full_name segue '
  'permitida. Nenhum segredo.';
