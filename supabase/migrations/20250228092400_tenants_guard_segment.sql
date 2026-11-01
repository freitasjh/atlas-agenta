-- Migration: tenants_guard_segment (ADR-04, revisão B, achado B-3)
-- Inclui `segment` no guard de colunas privilegiadas de `tenants`.
-- Substitui a função de 20250227091000 (já aplicada, por isso não é editada).
--
-- Motivo: a policy tenants_update_own_admin (20250216091000) deixa o admin atualizar a própria
-- linha de tenants, e o guard antigo protegia só subscription_status, plan e trial_ends_at.
-- Uma troca de `segment` pela API fazia a régua do tenant ser comparada com os textos de outro
-- ramo em bootstrap_super_admin (passo 4b), recusando a conversão de uma régua intacta.
-- Nenhuma tela do frontend altera `segment` (ele é gravado só no cadastro), então travar a
-- coluna não muda nada que o usuário veja. Cadastro (trigger handle_new_user) faz INSERT, não
-- UPDATE, e não é afetado pelo guard.
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
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.segment is distinct from old.segment then
      raise exception 'privileged_column_change_denied'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
comment on function public.tenants_guard_privileged_columns() is
  'Barra a escrita de tenants.subscription_status/plan/trial_ends_at/segment por sessao do '
  'cliente (auth.role() = authenticated). Essas colunas ficam para o service role (Edge Function '
  'admin-subscription / RPC admin_set_subscription_status) e para o cadastro. Edicao de cadastro '
  '(trade_name/legal_name/phone/document/timezone) segue permitida. Nenhum segredo.';
