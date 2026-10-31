-- Migration: reserva da troca de senha com token (ADR-08, decisão do usuário: opção b).
-- Problema: release_password_change_claim e complete_password_change limpavam a reserva filtrando
-- só por id. Uma requisição atrasada, cuja reserva já expirou, podia apagar a reserva de outra troca
-- mais nova. A correção: a reserva devolve um token (o próprio instante de expiração) e a liberação
-- e a conclusão só agem se o token ainda for o da reserva ativa.
--
-- Escopo desta migration:
-- 1. claim_password_change(uuid) passa a devolver (claim_status, claim_token). Troca de tipo de
--    retorno exige drop; a versão anterior (20250228095000) é removida aqui.
-- 2. release_password_change_claim(uuid, timestamptz) e a nova finish_password_change(uuid,
--    timestamptz) só agem com o token da própria reserva.
-- 3. complete_password_change (ADR-05) não é alterada nesta migration: assinatura e corpo
--    permanecem como estão em 20250228095000.
-- Relógio: claim e expiração usam clock_timestamp(), para que o token seja único por reserva.
-- Migrations já aplicadas não são editadas.

-- ============================================================================
-- 1. Versão anterior removida (só a Edge Function a usava, e ainda não foi liberada).
-- ============================================================================
drop function if exists public.claim_password_change(uuid);
drop function if exists public.release_password_change_claim(uuid);

-- ============================================================================
-- 2. claim_password_change: reserva atômica e devolve o token da reserva.
--    claim_status: claimed | in_progress | not_required.
--    claim_token: expiração da reserva tomada (nulo quando não houve reserva).
-- ============================================================================
create or replace function public.claim_password_change(p_user_id uuid)
returns table (claim_status text, claim_token timestamptz)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_token timestamptz;
begin
  update public.profiles
     set password_change_claimed_until = clock_timestamp() + interval '60 seconds'
   where id = p_user_id
     and must_change_password = true
     and (password_change_claimed_until is null
          or password_change_claimed_until <= clock_timestamp())
  returning password_change_claimed_until into v_token;

  if found then
    return query select 'claimed'::text, v_token;
    return;
  end if;

  if exists (
    select 1 from public.profiles
     where id = p_user_id and must_change_password = true
  ) then
    return query select 'in_progress'::text, null::timestamptz;
    return;
  end if;

  return query select 'not_required'::text, null::timestamptz;
end;
$$;

comment on function public.claim_password_change(uuid) is
  'Reserva a troca de senha do usuario (ADR-08). Devolve claim_status (claimed, in_progress ou '
  'not_required) e claim_token, a expiração da reserva tomada. Executável somente por service_role.';

-- ============================================================================
-- 3. release_password_change_claim: libera só a reserva do token informado.
-- ============================================================================
create or replace function public.release_password_change_claim(
  p_user_id uuid,
  p_claim_token timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.profiles
     set password_change_claimed_until = null
   where id = p_user_id
     and password_change_claimed_until = p_claim_token;
end;
$$;

comment on function public.release_password_change_claim(uuid, timestamptz) is
  'Libera a reserva de troca de senha só quando o token confere com a reserva ativa (ADR-08). '
  'Não mexe no flag. Executável somente por service_role.';

-- ============================================================================
-- 4. finish_password_change: zera o flag só quando o token ainda é o da reserva ativa.
--    false = a reserva foi tomada por outra troca (ou já concluída): a requisição foi superada.
-- ============================================================================
create or replace function public.finish_password_change(
  p_user_id uuid,
  p_claim_token timestamptz
)
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
     and must_change_password = true
     and password_change_claimed_until = p_claim_token;
  return found;
end;
$$;

comment on function public.finish_password_change(uuid, timestamptz) is
  'Zera must_change_password só se o token confere com a reserva ativa (ADR-08). Retorna false '
  'quando a troca foi superada por outra. Executável somente por service_role.';

-- ============================================================================
-- 5. Permissões: menor privilégio, só service_role.
-- ============================================================================
revoke all on function public.claim_password_change(uuid) from public, anon, authenticated;
grant execute on function public.claim_password_change(uuid) to service_role;

revoke all on function public.release_password_change_claim(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_password_change_claim(uuid, timestamptz) to service_role;

revoke all on function public.finish_password_change(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finish_password_change(uuid, timestamptz) to service_role;
