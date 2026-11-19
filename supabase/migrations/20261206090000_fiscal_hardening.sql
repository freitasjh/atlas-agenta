-- Migration: ADR-03 — hardening do schema fiscal (ADR-02 viável).
-- Aditiva e idempotente. Não altera migration já aplicada; só aperta o futuro.
--
-- 1. CHECK de formato da chave de acesso: 44 dígitos (PRD RF-05, ADR-02
--    "chave 44 dígitos"). `chave_acesso` continua nullable até autorizar; quando
--    informada, tem que casar `^[0-9]{44}$`. Dupla defesa com o zod
--    `ChaveAcessoSchema` do emissor (banco nunca confia só na Edge).
-- 2. Revogação explícita de TRUNCATE em tabelas fiscais para anon/authenticated
--    (defesa em profundidade: `revoke all` da ADR-02 já cobre, mas TRUNCATE
--    merece vedação nominal e auditável; escrita continua só service_role).

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fiscal_documents_chave_formato_check'
  ) then
    alter table public.fiscal_documents
      add constraint fiscal_documents_chave_formato_check
      check (chave_acesso is null or chave_acesso ~ '^[0-9]{44}$');
  end if;
end
$$;

revoke truncate on table public.fiscal_documents from anon, authenticated;
revoke truncate on table public.fiscal_events from anon, authenticated;
