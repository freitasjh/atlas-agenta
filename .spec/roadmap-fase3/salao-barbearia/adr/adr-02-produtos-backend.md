# ADR-02 — Produtos (catálogo) backend: tabela + N:N profissionais

- Status: proposto

## Contexto

G12 exige CRUD de produtos (nome, SKU, categoria backbar/varejo/ambos, unidade, custo, preço venda, mínimo, ativo, profissionais N:N), RBAC admin, gating segmento+plano. Base: `services` (catálogo operacional) + `service_professionals` (N:N por tenant). Produtos são dado operacional (SELECT aberto ao tenant; escrita só admin), com isolamento `tenant_id` do JWT, `*_cents`/UTC, sem DELETE físico.

## Decisão

Uma migration aditiva (única para este ADR):

- Tabela `products`: `id, tenant_id, name, sku, category text check in ('backbar','retail','both'), unit text, cost_cents int check >=0, price_cents int check >=0, min_qty int check >=0 default 0, active bool default true, commission_pct numeric(5,2) default 0 check 0..100, created_at`. `tenant_id` not null default `current_tenant_id()`, FK tenants. `unique (tenant_id, id)` alvo das FKs compostas. Índice `products_tenant_id_idx`.
- N:N `product_professionals`: `tenant_id, product_id, professional_id`, FKs compostas por tenant, unique `(tenant_id, product_id, professional_id)`, índices por tenant/produto/profissional.
- RLS: SELECT aberto ao tenant (todo papel); escrita só admin (policy `products_write_admin`, `product_professionals_write_admin` com USING+WITH CHECK). Sem policy super_admin cross-tenant.
- `category` determina uso (backbar baixa por atendimento; retail venda PDV); `both` permite os dois.
- `commission_pct` é a comissão por produto (G13) — percentual exato numeric(5,2), fonte de verdade.
- Sem estoque aqui (saldo vive em ADR-03).

## Consequências

- Positivas: backend mínimo, reutiliza padrão services; multi-tenant seguro; idempotente.
- Negativas/risco: N:N profissionais opcional para backbar; UI decide obrigatoriedade.
- LGPD: sem PII em log.

## Escopo

Entra: migration products + product_professionals + RLS/RBAC + testes `db reset`. Não entra: estoque, movimentações, varejo, comissão fórmula, UI.

## Arquivos afetados

- `supabase/migrations/{ts}_products.sql`
- Testes integração PG real: CRUD, RLS cross-tenant, RBAC (receptionist lê/escreve negado), N:N coerência de tenant.

## Critérios de aceite (testáveis)

1. `db reset` 2x aplica sem erro; tabelas têm `tenant_id` + índice + RLS ativa.
2. Tenant B não lê produto do tenant A (RLS); receptionist/professional não escrevem (policy nega).
3. N:N cross-tenant negado (FK composta).
4. Valores `*_cents`, sem float; `commission_pct` 0..100.

## Dependência

ADR-01 (contrato de gating; backend pode desenvolver em paralelo, mas UI depende de ADR-01).