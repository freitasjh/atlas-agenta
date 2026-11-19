-- Migration: hardening RBAC de estoque (Fase 3 ADR-03, iteração de review).
-- 1) Restringe insert em stock_movements por papel/tipo:
--    receptionist apenas consume/replenish; admin todos (inclui adjust).
-- 2) Remove grant de get_stock_balance/get_stock_level de anon.
-- 3) Protege products.stock_qty de edição direta por authenticated/anon
--    (saldo só muda via trigger stock_movements_apply / RPCs).
-- 4) Documenta race de idempotência em consume_stock.

-- ============================================================================
-- 1. Policy de insert por papel/tipo
-- ============================================================================
drop policy if exists stock_movements_insert_operational on public.stock_movements;
create policy stock_movements_insert_operational on public.stock_movements for insert
  with check (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'admin'
      or (
        current_role_name() = 'receptionist'
        and movement_type in ('consume', 'replenish')
      )
    )
  );

-- ============================================================================
-- 2. Revoga execução de leitura de saldo para anon
-- ============================================================================
revoke execute on function public.get_stock_balance(uuid) from anon;
revoke execute on function public.get_stock_level(uuid) from anon;

-- ============================================================================
-- 3. Protege products.stock_qty de edição direta (admin não edita coluna)
-- ============================================================================
revoke update (stock_qty) on table public.products from anon, authenticated;

-- ============================================================================
-- 4. Documentação da race de idempotência em consume_stock
-- ============================================================================
comment on function public.consume_stock(uuid, int, uuid, text) is
  'Baixa por atendimento. Idempotente por (tenant, appointment, product) via '
  'unique index stock_movements_consume_idem_idx. '
  'NOTA: o pré-check (SELECT existing) + INSERT não é atomicamente serializado '
  'entre sessões concorrentes; em corrida o segundo INSERT pode levantar '
  'unique_violation (SQLSTATE 23505). Chamadores devem tratar 23505 como '
  '"já consumido" e re-ler o movimento existente.';

