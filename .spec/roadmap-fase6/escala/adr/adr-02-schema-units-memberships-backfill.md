# ADR-02 — Schema `units` + `unit_memberships` + `unit_id` com backfill

- **Status**: Aceito (design congelado)
- **PRD**: §6.1, §7 (backfill obrigatório), §15, RF-01..RF-07, RF-44
- **UX-SPEC**: §3, §11 (W3), Q1/Q3
- **Depende de**: ADR-01 (feature/limite)
- **Bloqueia**: ADR-03 (RLS/policies), ADR-05 (CRUD), ADR-07 (ledger por unidade)
- **Escopo de escrita**: `supabase/migrations/`, `src/types/domain.ts`

## Contexto

O modelo é single-unit por construção: `tenants` tem um endereço; `appointments`,
`working_hours`, `resources`, `stock_movements` e `appointment_payments` não têm dimensão
física. `products.stock_qty` é um **escalar por tenant** (`20261119090000_stock.sql:12`), e o
saldo é mantido por trigger a partir de `stock_movements` — não existe saldo por unidade. Não
existe tabela de caixa: o fechamento é derivado do ledger (`useFechamentoBalcao`), então
"caixa por unidade" é atributo do pagamento, não de uma sessão de caixa.

Criar unidade sem backfill esconde histórico (W3): qualquer linha órfã de `unit_id`
desaparece de relatórios por unidade. A constraint de conflito é por
`(tenant_id, professional_id, tstzrange)` (`20250219092000_appointments_no_overlap.sql`) e
**não** pode ganhar `unit_id` na chave (R8).

## Decisão

### D1 — `units`

Tabela de domínio com `tenant_id`, endereço operacional, `short_name` ≤12, `active`,
`suspended_at` (nula por padrão; escrita só por caminho administrativo — ADR-14), timestamps.
`unit_memberships` explícita (Q-derivada) liga `profile_id` a `unit_id`. Ambas seguem o
padrão de isolamento: `tenant_id default current_tenant_id()`, índice por `tenant_id`,
`unique (tenant_id, id)` como alvo de FK composta (padrão de
`catalogo-operacional-schema-rls`). Unidade **não tem** `timezone` (fuso herdado do tenant —
decisão aprovada) nem CNPJ/IE (fora do escopo fiscal).

### D2 — `unit_id` nas entidades operacionais

| Tabela | Coluna | Obrigatoriedade | Origem |
|---|---|---|---|
| `appointments` | `unit_id` | NOT NULL após backfill | cliente (form/agenda) validado por membership |
| `working_hours` | `unit_id` | NOT NULL após backfill | cliente, escopo da grade (Q4) |
| `resources` | `unit_id` | NOT NULL após backfill | cliente (recurso é físico) |
| `stock_movements` | `unit_id` | NOT NULL após backfill | cliente (movimento é físico) |
| `product_unit_stock` (nova) | `unit_id` | NOT NULL | derivado do movimento |
| `appointment_payments` | `unit_id` | NOT NULL após backfill | **derivado** de `appointments.unit_id` |
| `charges` | `unit_id` | nullable | **derivado** quando `appointment_id` não é nulo |

`appointments.unit_id` carrega FK composta `(tenant_id, unit_id) → units(tenant_id, id)`.
`appointment_payments` e `charges` recebem o valor por trigger `BEFORE INSERT/UPDATE`
(derivação server-side, imutável após gravação — R9). Cliente nunca envia `unit_id` de
isolamento; quando envia `unit_id` de operação (agenda/movimento), o banco valida
membership (ADR-03).

### D3 — Backfill matriz (idempotente, com contagem)

1. Para cada tenant sem unidade, criar **uma** unidade "matriz": `name` = `trade_name` (ou
   "Matriz"), `short_name` = "Matriz", endereço copiado de `tenants` (campos de
   `20261104192210_tenants_cadastro_rico_endereco.sql`), `active=true`.
2. Criar `unit_memberships` para **todos** os `profiles` do tenant na matriz (admin,
   recepção e profissional), garantindo operação idêntica ao single-unit.
3. Backfill `unit_id` = matriz em `appointments`, `working_hours`, `resources`,
   `stock_movements`; derivar em `appointment_payments`/`charges` a partir do atendimento.
4. Validar contagem: `count(*) where unit_id is null = 0` antes de aplicar `NOT NULL`; se
   sobrar linha órfã, a migration **falha explicitamente** (nunca aplica constraint com
   órfão).
5. `product_unit_stock`: para cada produto, criar linha na matriz com `products.stock_qty`
   atual; `products.stock_qty` passa a ser soma derivada mantida pelo trigger (compatibilidade
   das telas existentes; nenhum saldo é inventado ou zerado).

Toda a migration é re-executável (`if not exists`, `where unit_id is null`, bloqueios `do $$`
para constraints) e **não altera** migrations aplicadas. `plans` segue catálogo global (sem
`tenant_id`/`unit_id`).

### D4 — Estoque segregado (sem transferência na v1)

`stock_movements.unit_id` é obrigatório; o saldo passa a viver em `product_unit_stock`
(`tenant_id, unit_id, product_id, qty` com `qty >= 0`, unique por trio). A v1 **não** cria
transferência entre unidades: movimentação entre unidades exige dois movimentos manuais
(saída + entrada) registrados como operações distintas, sem vínculo de transferência.
`products` continua tenant-level (catálogo e preço únicos — Q1/Q2).

### D5 — Nenhuma tabela nova "de caixa"

Caixa/fechamento por unidade é recorte do ledger (`appointment_payments.unit_id`) e das
vendas (`charges.unit_id`), não uma entidade nova. Se uma fase futura criar sessão de caixa,
ela nascerá com `unit_id` obrigatório.

### D6 — Catálogo de serviços (Q1)

`services`/`combos`/`packages` continuam tenant-level. Vínculo por unidade em
`service_units` (`tenant_id, unit_id, service_id`, unique por trio, FKs compostas). Serviço
sem linha em `service_units` está habilitado em **todas** as unidades (default retrocompatível);
linha presente restringe às unidades listadas. Criar unidade **nunca** re-semeia catálogo
(W4) nem cria `service_units` em massa.

## Interface congelada

| Objeto | Contrato |
|---|---|
| `units` | `id, tenant_id, name, short_name (1..12), cep, street, number, complement, district, city, state, phone, active, suspended_at, created_at, updated_at`; `unique (tenant_id, id)` |
| `unit_memberships` | `id, tenant_id, unit_id, profile_id, created_at`; `unique (tenant_id, unit_id, profile_id)` |
| `product_unit_stock` | `tenant_id, unit_id, product_id, qty int >= 0`; `unique (tenant_id, unit_id, product_id)` |
| `service_units` | `tenant_id, unit_id, service_id`; `unique` por trio; ausência = habilitado em todas |
| `appointment_payments.unit_id` | NOT NULL, imutável, derivado; nunca aceito do cliente |
| `charges.unit_id` | nullable; derivado quando há `appointment_id`, imutável depois |

## Consequências

**Positivas**
- Histórico nunca fica órfão; tenant single-unit vira "1 unidade matriz" e segue idêntico.
- Estoque por unidade real (sem saldo compartilhado enganoso).
- FK composta impede vínculo cross-tenant de membership/serviço.

**Negativas / custos**
- Backfill de estoque precisa reconciliar `products.stock_qty` (trigger duplo) — ponto de
  regressão mais sensível da fase.
- `unit_id` NOT NULL em tabelas grandes exige janela de migration com validação de contagem.

**Riscos e mitigação**
- *Risco*: trigger de estoque divergir saldo por unidade do total. *Mitigação*: teste de
  invariante `sum(product_unit_stock.qty) = products.stock_qty` após qualquer movimento.
- *Risco*: `charges` de assinatura (sem appointment) ficarem sem unidade e vazarem no DRE por
  unidade. *Mitigação*: explicitamente tenant-level, nunca rateadas (ADR-07).

## Escopo

**Entra**
- Tabelas novas, colunas `unit_id`, backfill matriz, memberships iniciais, saldo por unidade,
  `service_units`, FKs compostas, índices, constraints de obrigatoriedade.

**Não entra**
- Transferência de estoque com vínculo, sessão de caixa, CNPJ/IE por unidade, preço por
  unidade, hierarquia tenant pai/filho, re-seed de catálogo, edição de migration existente.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20261217090000_units_units_memberships.sql` | tabelas + RLS base + índices |
| `supabase/migrations/20261217091000_units_backfill_matriz.sql` | backfill + `NOT NULL` guardado |
| `supabase/migrations/20261217092000_stock_por_unidade.sql` | `product_unit_stock` + trigger |
| `supabase/migrations/20261217093000_service_units.sql` | vínculo serviço↔unidade |
| `supabase/migrations/20261217094000_ledger_unit_derive.sql` | derivação imutável em ledger/charges |
| `src/types/domain.ts` | tipos `Unit`, `UnitMembership` (aditivo) |

## Critérios de aceite (testáveis)

- [ ] `db reset` roda duas vezes sem erro (idempotência).
- [ ] Tenant existente termina com exatamente 1 unidade ativa, todos os `profiles` com
      membership nela e 0 linhas com `unit_id is null` nas tabelas obrigatórias.
- [ ] Tentativa de inserir `appointments.unit_id` de outro tenant falha por FK composta.
- [ ] `appointment_payments.unit_id` diverge do `appointments.unit_id` → trigger rejeita
      (inclusive em UPDATE).
- [ ] `sum(product_unit_stock.qty) = products.stock_qty` para todo produto após N movimentos.
- [ ] Criar unidade não insere linhas em `services`/`products`/`service_units`.
- [ ] Serviço sem linha em `service_units` aparece habilitado em todas as unidades.

## Dependência / ordem

Depois de ADR-01. Antes de ADR-03 (as policies referenciam `unit_memberships`) e de ADR-07
(a derivação do ledger é pré-requisito do recorte financeiro).
