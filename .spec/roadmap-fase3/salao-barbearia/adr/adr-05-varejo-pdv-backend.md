# ADR-05 — Varejo PDV (venda de produto) backend

- Status: proposto

## Contexto

Varejo no PDV: segmented Serviço|Produto|Combo, venda produto (select estoque, stepper qty, preço read-only, total, comissão preview), esgotado desabilitado, estoque insuficiente bloqueia, baixa automática + comissão por produto. Base: `create-walk-in` Edge/RPC existente cria appointment a partir de serviço/combo. Precisa suportar venda de produto sem criar segundo financeiro: produto vira appointment com `product_id` + `qty`, preço = qty * product.price_cents, comissão por produto (ADR-04), consumo de estoque (ADR-03) ao concluir, origem `walk_in`.

## Decisão

Migration + RPC/Edge:

- `appointments`: add `product_id uuid nullable`, `product_qty int not null default 0 check >=0`, FK composta `(tenant_id, product_id) -> products` (nullable). Constraint: exatamente um entre `service_id`/`combo_id`/`product_id` não-nulo (CHECK). `price_cents` = qty*price para produto (gravado pelo RPC/Edge, não cliente).
- `create-walk-in` (Edge ou RPC) aceita `selection.kind = 'product'` com `productId` + `qty`; valida estoque disponível (>= qty) antes de criar; se insuficiente → erro tipado `STOCK_INSUFFICIENT`. Preço calculado no servidor.
- Consumo de estoque: ao concluir o appointment de produto (transição a `concluido`), chamar `consume_stock(product_id, qty, appointment_id, 'venda_pdv')` (idempotente). Para serviço/combo não consome. Pode ser no trigger de transição (SECURITY DEFINER function chamada pelo trigger) ou Edge; decisão: trigger chama `consume_stock` quando `product_id is not null` e status entra em `concluido`. Se estoque insuficiente no momento da conclusão → bloqueia transição com erro tipado (venda não conclui sem baixa).
- Comissão: trigger ADR-04 já apura origin='product' usando `products.commission_pct`.
- Venda com estoque 0: bloqueada na criação (erro `STOCK_INSUFFICIENT`); não permite negativo (MVP).
- Cancelamento de venda de produto: não repõe estoque automaticamente (consistente com cancelado não estorna comissão/pagamento; reposição manual via ajuste). Documentado.

## Consequências

- Positivas: ledger único (appointment + appointment_payments), sem tabela de vendas paralela; consumo idempotente; bloqueio claro.
- Negativas/risco: trigger de conclusão ganha mais responsabilidade (consume + commission) → testes de integração obrigatórios; se consume falhar, transação inteira falha (desejável).
- LGPD: sem PII em log.

## Escopo

Entra: migration appointments product fields + constraint + trigger update + create-walk-in handling + testes. Não entra: UI PDV, gating, split/recursos.

## Arquivos afetados

- `supabase/migrations/{ts}_appointments_product.sql`
- `supabase/functions/create-walk-in/` (ou RPC) — atualização de contrato
- Testes integração: venda produto cria appointment com preço correto; estoque insuficiente bloqueia; conclusão consome estoque idempotente; cancelamento não consome; comissão origin product.

## Critérios de aceite (testáveis)

1. `db reset` 2x sem erro.
2. Criar walk-in produto com qty válida → appointment com `product_id`, `product_qty`, `price_cents = qty*price`.
3. Estoque < qty → criação falha com erro tipado, sem appointment.
4. Concluir appointment produto → estoque reduzido em qty; concluído de novo não reduz de novo.
5. Cancelar → estoque inalterado.
6. Comissão apurada origin='product' com pct do produto.
7. Tenant B não acessa.

## Dependência

ADR-02, ADR-03, ADR-04. ADR-01 (gating).