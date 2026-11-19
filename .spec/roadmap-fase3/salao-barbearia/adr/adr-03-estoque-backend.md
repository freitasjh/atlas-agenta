# ADR-03 — Estoque (saldo + movimentações) backend

- Status: proposto

## Contexto

G12 exige estoque backbar+varejo: listagem com status OK/Baixo/Crítico, KPIs de alerta, movimentações (baixa por atendimento, reposição, ajuste inventário), reposição (lote/validade/fornecedor), inventário (wizard 2 etapas, divergência com motivo). Base: `products` (ADR-02). Precisa ledger de movimentações append-only (RF-24), alertas por `min_qty`, RLS tenant, RBAC (receptionist registra baixa/reposição operacional sem financeiro).

## Decisão

Uma migration aditiva:

- Tabela `stock_movements`: `id, tenant_id, product_id, movement_type text check in ('consume','replenish','adjust'), qty_delta int not null (pode ser negativo em consume/adjust), qty_before int, qty_after int, reason text, appointment_id uuid nullable, batch text, expires_at timestamptz, supplier text, unit_cost_cents int, created_by uuid, created_at`. FK composta `(tenant_id, product_id) -> products`. `appointment_id` FK composta appointments (nullable). Append-only: sem UPDATE/DELETE policy (só INSERT/SELECT). Índices por tenant/produto/data.
- Saldo derivado: view/RPC `get_stock_level(p_product_id)` = sum(qty_delta); ou coluna materializada `products.stock_qty` atualizada por trigger? Decisão: manter `products.stock_qty int not null default 0` atualizado por trigger AFTER INSERT em stock_movements (simplifica leitura e alertas) + movimento é a fonte. Trigger `stock_movements_apply` atualiza `products.stock_qty += qty_delta` e preenche `qty_before/qty_after`. Guard: não permite estoque negativo em `consume` (bloqueia venda) — configuração `allow_negative` fora do MVP (default false).
- RPCs `SECURITY DEFINER`:
  - `consume_stock(p_product_id, p_qty, p_appointment_id, p_reason)` — baixa por atendimento; idempotente por `(tenant_id, appointment_id, product_id)` (unique parcial) para não duplicar em retry.
  - `replenish_stock(p_product_id, p_qty, p_batch, p_expires_at, p_supplier, p_unit_cost_cents)` — reposição.
  - `adjust_stock(p_product_id, p_qty_delta, p_reason)` — ajuste inventário (motivo obrigatório).
  - `list_low_stock()` — produtos com `stock_qty <= min_qty` (status OK/Baixo/Crítico por threshold: crítico = 0 ou <= min/2).
- Alertas: status calculado na view/RPC (`ok` se > min_qty, `low` se >0 e <= min_qty, `critical` se <=0).
- RLS: SELECT aberto ao tenant (todo papel lê saldo/alertas); INSERT aberto a admin+receptionist (baixa/reposição/ajuste operacional); professional pode consumir? PRD: receptionist registra baixa. Manter INSERT para admin+receptionist; professional não escreve estoque. Sem financeiro.
- Inventário wizard: frontend chama `adjust_stock` por item com divergência + motivo; backend não bloqueia por % (decisão #2 fica no frontend/config, mas backend aceita qualquer ajuste com motivo).

## Consequências

- Positivas: ledger append-only auditável; saldo consistente via trigger; idempotência de consumo; alertas simples.
- Negativas/risco: trigger de saldo pode divergir se movimento falhar mid-flight → transação atômica por RPC; testes cobrem.
- LGPD: sem PII em log.

## Escopo

Entra: migration stock_movements + trigger + RPCs + RLS/RBAC + testes db reset. Não entra: UI, varejo, comissão, split/recursos.

## Arquivos afetados

- `supabase/migrations/{ts}_stock.sql`
- Testes integração: consumo/reposição/ajuste, idempotência, estoque negativo bloqueado, RLS cross-tenant, alertas status.

## Critérios de aceite (testáveis)

1. `db reset` 2x sem erro.
2. Consumo reduz saldo; reposição aumenta; ajuste com motivo altera saldo e grava movimento.
3. Consumo duplicado (mesmo appointment+produto) é idempotente (sem segunda baixa).
4. Estoque não fica negativo em consume (erro tipado).
5. Tenant B não lê movimento do tenant A.
6. `list_low_stock` retorna status correto por threshold.

## Dependência

ADR-02 (products).