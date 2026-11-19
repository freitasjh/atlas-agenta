-- Migration: fecha bypass de products.stock_qty (Fase 3 ADR-03, iteração review 2).
-- `revoke update (stock_qty)` (migration 20261119100000) é ineficaz: o privilégio
-- UPDATE de tabela permanece para anon/authenticated (grants padrão do Supabase),
-- então qualquer autenticado editava stock_qty direto, contornando ledger/trigger.
-- Correção: revogar UPDATE em nível de tabela e re-conceder apenas as colunas
-- cadastrais. stock_qty (e colunas de identidade/auditoria) ficam sem grant.
-- O trigger stock_movements_apply (SECURITY DEFINER) e os RPCs seguem alterando
-- stock_qty como owner, sem depender destes grants.

revoke update on table public.products from anon, authenticated;

grant update (
  name, sku, category, unit, cost_cents, price_cents, min_qty, active, commission_pct
) on table public.products to authenticated;

-- anon: sem UPDATE direto (RLS já negava; agora a barreira é de privilégio).