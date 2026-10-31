-- Migration: claim atômico da troca de senha (ADR-08, decisão do usuário: reserva no banco).
-- Problema: duas requisições concorrentes de troca do mesmo usuário podiam passar na checagem do
-- flag e gravar senhas diferentes no Auth. A reserva passa a ser feita no banco, antes da escrita
-- no Auth, por um UPDATE condicional (atômico na linha).
--
-- Mudanças:
-- 1. Coluna profiles.password_change_claimed_until (timestamptz, UTC): fim da reserva ativa.
--    Nula = sem reserva. Expira sozinha, para que uma queda da Edge Function não trave a conta.
-- 2. Guard profiles_guard_privileged_columns() passa a proteger a nova coluna contra escrita da
--    sessão do cliente (auth.role() = 'authenticated'). Mesma regra das demais colunas.
-- 3. claim_password_change(uuid): reserva a troca. Retorna 'claimed', 'in_progress' ou
--    'not_required'. Só service_role executa.
-- 4. release_password_change_claim(uuid): libera a reserva quando a escrita no Auth ou a RPC
--    de conclusão falha. Só service_role executa.
-- 5. complete_password_change(uuid): mesma assinatura e mesmo retorno da ADR-05. Passa a limpar
--    a reserva ao zerar o flag.
--
-- Migrations anteriores não foram editadas (já aplicadas). Esta migration é a única mudança.
-- Idempotente no re-apply (add column if not exists, create or replace, drop/create de trigger).
-- Nenhum dinheiro aqui. Nenhum segredo.

-- ============================================================================
-- 1. Coluna da reserva.
-- ============================================================================
alter table public.profiles
  add column if not exists password_change_claimed_until timestamptz;

-- ============================================================================
-- 2. Guard: inclui a coluna da reserva. Mesmo corpo da versão 20250228091700, com um campo a mais.
-- ============================================================================
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
       or new.password_changed_at is distinct from old.password_changed_at
       or new.password_change_claimed_until is distinct from old.password_change_claimed_until then
      raise exception 'privileged_column_change_denied'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.profiles_guard_privileged_columns() is
  'Barra a escrita de profiles.id/role/tenant_id/must_change_password/password_changed_at/'
  'password_change_claimed_until por sessao do cliente (auth.role() = authenticated). Essas colunas '
  'ficam restritas ao service role e a funcoes security definer executadas por ele (bootstrap, '
  'troca de senha). Fecha o escalonamento de privilegio em profiles (ADR-02 Super Admin). Edicao '
  'de full_name segue permitida. Nenhum segredo.';

-- O trigger profiles_guard_privileged_columns_trg (20250228091500) já aponta para a função pelo nome.

-- ============================================================================
-- 3. claim_password_change: reserva atômica da troca.
-- ============================================================================
-- Duração da reserva. Precisa ser maior que o tempo de uma chamada ao Auth (poucos segundos) e
-- curta o bastante para que uma queda não bloqueie a troca por muito tempo.
create or replace function public.claim_password_change(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Um único UPDATE condicional decide a corrida: só uma sessão casa a condição por linha.
  update public.profiles
     set password_change_claimed_until = now() + interval '60 seconds'
   where id = p_user_id
     and must_change_password = true
     and (password_change_claimed_until is null or password_change_claimed_until <= now());
  if found then
    return 'claimed';
  end if;

  if exists (
    select 1 from public.profiles
     where id = p_user_id and must_change_password = true
  ) then
    return 'in_progress';
  end if;

  return 'not_required';
end;
$$;

comment on function public.claim_password_change(uuid) is
  'Reserva a troca de senha do usuario (ADR-08). Retorna claimed (reserva tomada), in_progress '
  '(outra troca com reserva ativa), not_required (flag ja zerado ou perfil inexistente). '
  'Executavel somente por service_role.';

-- ============================================================================
-- 4. release_password_change_claim: libera a reserva após falha antes da conclusão.
-- ============================================================================
create or replace function public.release_password_change_claim(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.profiles
     set password_change_claimed_until = null
   where id = p_user_id
     and must_change_password = true;
end;
$$;

comment on function public.release_password_change_claim(uuid) is
  'Libera a reserva de troca de senha quando a escrita no Auth ou a conclusao falha (ADR-08). '
  'Nao mexe no flag. Executavel somente por service_role.';

-- ============================================================================
-- 5. complete_password_change: mesma assinatura da ADR-05, agora também limpa a reserva.
-- ============================================================================
create or replace function public.complete_password_change(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.profiles
     set must_change_password = false,
         password_changed_at = now(),
         password_change_claimed_until = null
   where id = p_user_id
     and must_change_password = true;
  return found;
end;
$$;

comment on function public.complete_password_change(uuid) is
  'Zera profiles.must_change_password, grava password_changed_at e limpa a reserva de troca para o '
  'usuario informado. Retorna true se alterou uma linha, false se o flag ja estava zerado ou o '
  'perfil nao existe. Executavel somente por service_role (ADR-05 e ADR-08 Super Admin).';

-- ============================================================================
-- 6. Permissões: menor privilégio. Nenhum papel de cliente executa as funções de troca.
-- ============================================================================
revoke all on function public.claim_password_change(uuid) from public, anon, authenticated;
grant execute on function public.claim_password_change(uuid) to service_role;

revoke all on function public.release_password_change_claim(uuid) from public, anon, authenticated;
grant execute on function public.release_password_change_claim(uuid) to service_role;

revoke all on function public.complete_password_change(uuid) from public, anon, authenticated;
grant execute on function public.complete_password_change(uuid) to service_role;
