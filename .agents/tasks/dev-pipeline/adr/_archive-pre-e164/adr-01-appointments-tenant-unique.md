# ADR-01 — `appointments` expõe `unique (tenant_id, id)` (alvo de FK composta)

- **Status:** proposto
- **Escopo:** dados
- **Depende de:** nenhuma ADR desta fase (pré-requisito de todas as de dados). Depende do schema já aplicado (`appointments`, migration `20250219091000_appointments.sql`).

## Contexto

A tabela `messages` (ADR-03) precisa de uma FK **composta** `(tenant_id, appointment_id) → appointments (tenant_id, id)` para garantir, no schema, que uma mensagem só referencia um agendamento do **mesmo tenant** (coerência de tenant no banco, não só na UI — padrão travado nas fases anteriores). Ao contrário de `customers`, `services` e `professionals` — que expõem `unique (tenant_id, id)` —, `appointments` (migration `20250219091000`) só tem `id uuid primary key` e nunca foi referenciada. Sem um par único `(tenant_id, id)` a FK composta de `messages` **falha no `supabase db reset`** por falta de alvo único.

A migration aplicada `20250219091000_appointments.sql` **não pode ser editada** (regra de versionamento: nova migration nunca edita aplicada). A correção é uma migration nova que adiciona o unique.

Decisão herdada da análise de dados (§4.2): **Opção A** — adicionar `unique (tenant_id, id)`. **Opção B** (FK simples `appointment_id → appointments(id)` sem o par de tenant) foi **descartada** por reabrir o buraco cross-tenant que as FKs compostas existem para fechar.

## Decisão

Criar a migration nova `supabase/migrations/20250220089000_appointments_tenant_unique.sql` que adiciona a constraint `unique (tenant_id, id)` em `appointments`, sem tocar a migration aplicada. Timestamp `20250220089000` é posterior à última existente (`20250219093000`) e **anterior** às migrations de `whatsapp_instances`/`messages` desta fase — garante que o alvo único exista antes da FK composta.

- Usar bloco idempotente para a constraint (não aceita `if not exists`): `do $$ begin if not exists (...pg_constraint...) then alter table appointments add constraint appointments_tenant_id_unique unique (tenant_id, id); end if; end $$;` — padrão de idempotência já usado nas migrations existentes.
- Não alterar RLS, índices de domínio nem colunas de `appointments`. A constraint única cria seu índice de suporte automaticamente.
- Não tocar o trigger da máquina de estados (`20250219093000`) nem os ganchos comentados nele — permanecem como estão.

## Consequências

- Habilita a FK composta de `messages` (ADR-03) sem erro no `db reset`.
- Mantém o padrão de coerência de tenant por FK composta consistente em todas as tabelas de domínio.
- Custo: um índice único adicional por tenant+id — barato e alinhado ao restante do schema.
- Nenhuma regressão esperada em escrita de `appointments` (o par `(tenant_id, id)` já é único de fato, pois `id` é PK global).

## Arquivos afetados

- `supabase/migrations/20250220089000_appointments_tenant_unique.sql` (novo)

## Critérios de aceite testáveis (desta ADR)

- **A1.** `supabase db reset` aplica a migration nova sem erro; re-run é idempotente (CA-01b). Em ambiente sem CLI, validar com Postgres em Docker aplicando as migrations em ordem (técnica registrada no brain do projeto).
- **A2.** Após o reset, `appointments` tem a constraint `unique (tenant_id, id)` (inspeção de `pg_constraint`/`\d appointments`).
- **A3.** A migration aplicada `20250219091000_appointments.sql` permanece byte-a-byte inalterada (`git diff` vazio nela).
