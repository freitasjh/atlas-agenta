-- Migration: cadastro de empresa por RPC transacional e remoção do trigger on_auth_user_created (ADR-02, RQ-19)
-- A regra de papel (empresa nova + profile admin) sai do trigger de auth.users e passa para a
-- Edge Function `signup-tenant`, que chama a RPC `create_tenant_with_admin` com service role.
-- Empresa, profile e os 5 templates nascem na mesma transação da RPC.
--
-- Não editamos migrations aplicadas (handle_new_user segue existindo até este drop). Nenhuma linha
-- de `tenants` é apagada aqui. Nenhum segredo neste arquivo. Dinheiro: nenhum. Tempo: timestamptz UTC.
-- ============================================================================
-- 1. RPC transacional de cadastro. Só o service role a executa (chamada pela Edge Function).
--    Segment fora do enum levanta erro explícito; NULL é aceito (fallback genérico, D2 da 20250225090000).
-- ============================================================================
create or replace function public.create_tenant_with_admin(
  p_user_id uuid,
  p_owner_email text,
  p_trade_name text,
  p_full_name text,
  p_segment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  if p_segment is not null and p_segment not in ('barbearia', 'clinica', 'salao') then
    raise exception 'segment_invalid' using errcode = 'invalid_parameter_value';
  end if;
  -- Empresa nova em trial (14 dias), igual ao cadastro anterior.
  insert into tenants (legal_name, trade_name, owner_email, plan, subscription_status, trial_ends_at, segment)
  values (
    p_trade_name,
    p_trade_name,
    p_owner_email,
    'individual',
    'trial',
    now() + interval '14 days',
    p_segment
  )
  returning id into v_tenant_id;
  -- Profile admin ligando o usuário Auth recém-criado à empresa. O role é fixo no servidor.
  insert into profiles (id, tenant_id, role, full_name)
  values (p_user_id, v_tenant_id, 'admin', p_full_name);
  -- Baseline das 5 chaves da régua no mesmo fluxo atômico.
  perform seed_message_templates(v_tenant_id, p_segment);
  return v_tenant_id;
end;
$$;
-- O PostgreSQL concede EXECUTE a PUBLIC por padrão. Fecha para todos e libera só o service role.
revoke all on function public.create_tenant_with_admin(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_tenant_with_admin(uuid, text, text, text, text)
  to service_role;
-- ============================================================================
-- 2. Remove o trigger de auth.users e, depois, a função que ele chamava. Ordem obrigatória:
--    o trigger depende da função. Idempotente no re-apply.
-- ============================================================================
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
