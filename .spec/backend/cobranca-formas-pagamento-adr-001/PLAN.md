# PLAN — ADR-001 Schema: ledger `appointment_payments` + `charges` gateway-only (scoped)

## 1. Contexto e rastreabilidade

- **SPEC:** `.spec/backend/cobranca-formas-pagamento-adr-001/SPEC.md`
- **ADR:** `.spec/prd/cobranca-formas-pagamento/ADRs/ADR-001-schema-ledger-recebimentos/ADR.md`
- **PRD:** `.spec/prd/cobranca-formas-pagamento/PRD.md` (RF-25, RF-28, RF-29; RNF-05/06/07/09/10)
- **Depende de:** —
- **Goal:** entregar uma migration única idempotente que crie o ledger, ajuste `charges`, feche RLS/grants e faça o backfill validado — sem RPC/Edge/UI.

### 1.1 Validação da SPEC

- **Status:** validada com 2 lacunas declaradas (D-01, D-02).
- **D-01:** o DDL resumido do ADR omite a FK de `voided_by`; a prosa congela `restrict` para `received_by`/`voided_by`. A SPEC inclui a constraint e exige correção do ADR no merge.
- **D-02:** `charges` aceita `amount_cents = 0`; uma cobrança paga com valor 0 não é representável no ledger (`amount_cents > 0`). A migration aborta com contagem antes do insert (fail-closed).
- **Assumptions:** nenhuma cobrança paga com valor 0 em produção; se houver, a origem é corrigida antes do deploy. `profiles (tenant_id,id)` e `appointments (tenant_id,id)` já são únicos (verificado no disco).

## 2. Estratégia técnica

- **Camada:** banco (Supabase/PostgreSQL). Nenhuma linha de TypeScript/Deno de aplicação.
- **Migration** `supabase/migrations/20261106120000_appointment_payments_ledger.sql`, aditiva e idempotente, na ordem 2.1→2.8 da SPEC.
- **RLS/grants:** uma policy de `select` admin; `revoke all` de `anon`/`authenticated`; `grant select` a `authenticated`; `grant all` a `service_role`.
- **Backfill:** `not exists (tenant_id, charge_id)` + validação `faltantes_antes == inseridas` dentro de `DO $$`.
- **Testes:** integração com `sql()` (psql por stdin) e cliente Supabase com JWT real; fixtures próprias e limpeza explícita por causa das FKs `restrict`.
- **Documentação:** atualização de `.agents/rules/dominio.md` + espelho `.kiro/steering/dominio.md`.

## 3. Mapeamento de restrições → ponto de aplicação

| Ref. SPEC | Restrição | Onde é imposta | Modo de falha | Estratégia |
|---|---|---|---|---|
| I1, RNF-05 | centavos inteiros e `amount_cents > 0` | `int` + `check` | linha com valor inválido | teste `23514` |
| I2 | enums `method`/`source` | `check` | método/origem inventado | teste `23514` |
| I3 | estorno consistente | `appointment_payments_void_consistent` | linha “meio estornada” | teste `23514` |
| I4, RNF-07 | 1 recebimento por cobrança | `appointment_payments_charge_uidx` | webhook + baixa duplicam receita | teste `23505` |
| I5, RNF-07 | idempotência do lote | `appointment_payments_idem_uidx` | replay duplica | teste `23505` + `line_index` distinto |
| I6, I10 | 1 PIX por atendimento, mesmo após pago | `charges_tenant_appointment_uidx` | 2ª cobrança PIX | teste `23505` com charge paga |
| I7, RF-29 | coerência de tenant | FKs compostas | linha cross-tenant | teste `23503` |
| I8, RNF-09 | `tenant_id` obrigatório | `not null` + default `current_tenant_id()` | linha órfã | insert sem tenant falha |
| I9, RF-25 | receita ignora estornada | contrato de leitura | número inflado | teste de soma com `voided_at` |
| §4 | escrita só privilegiada | RLS + grants | cliente grava receita | `has_table_privilege` + insert negado |
| §5, RF-28 | backfill 1:1 e idempotente | `not exists` + `DO` com contagem | receita histórica errada | reset 2× + teste de reexecução |

## 4. Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261106120000_appointment_payments_ledger.sql` | criar | DDL do ledger, uniques, índices, RLS/grants, backfill |
| `tests/integration/helpers/payments-fixtures.ts` | criar | fixtures mínimas + `cleanupPaymentFixtures` (ordem de limpeza) |
| `tests/integration/security/appointment-payments-schema.test.ts` | criar | catálogo, checks, uniques, invariantes |
| `tests/integration/security/appointment-payments-rls.test.ts` | criar | RLS admin × operação, grants, FKs cross-tenant |
| `tests/integration/security/appointment-payments-backfill.test.ts` | criar | 1:1, reexecução, notice, receita não estornada |
| `.agents/rules/dominio.md` | alterar | regra de domínio (sem PIX automático; ledger) |
| `.kiro/steering/dominio.md` | alterar | espelho da mesma regra |

Fora da lista: nada. `supabase/functions/**` e `src/**` intocados.

## 5. Fases e dependências

### Fase 1 — Schema base
- **Tasks:** BE-01.
- **Dependências:** nenhuma.
- **Entrega:** tabela criada com checks/FKs; helper de fixtures e primeiro teste (RED → GREEN).

### Fase 2 — Unicidade, `charges` e índices
- **Tasks:** BE-02.
- **Dependências:** BE-01.
- **Entrega:** uniques do ledger, cap de PIX por tenant, `charges.idempotency_key`, índices de consulta.

### Fase 3 — RLS/grants
- **Tasks:** BE-03.
- **Dependências:** BE-02 (tabela completa).
- **Entrega:** policy admin-only, `revoke all`, `grant select`, `grant all` service role.

### Fase 4 — Backfill
- **Tasks:** BE-04.
- **Dependências:** BE-03 (tabela + grants prontos).
- **Entrega:** backfill idempotente com guarda de valor e validação de contagem.

### Fase 5 — Endurecimento de testes
- **Tasks:** BE-05, BE-06, BE-07.
- **Dependências:** BE-02/BE-03/BE-04 respectivamente.
- **Entrega:** invariantes SQL, RLS/RBAC por papel, backfill/idempotência/receita.

### Fase 6 — Regras de domínio
- **Tasks:** BE-08.
- **Dependências:** BE-01 (terminologia congelada). Soft.
- **Entrega:** `dominio.md` + espelho atualizados; grep de não regressão.

### Fase 7 — Verificação final
- **Tasks:** BE-09.
- **Dependências:** todas.
- **Entrega:** reset 2×, suíte unitária e de integração verdes, grep das regras, revisão do diff restrito.

## 6. Caminho crítico

`BE-01 → BE-02 → BE-03 → BE-04 → BE-05 → BE-06 → BE-07 → BE-09`
`BE-08` pode rodar em paralelo após BE-01 (soft), mas entra antes de BE-09.

## 7. Riscos

| Risco | Nível | Impacto | Mitigação |
|---|---|---|---|
| Backfill parcial/duplicado | **High** | receita histórica errada | `not exists` + `faltantes_antes == inseridas` + reset 2× + teste de reexecução |
| Unique global removido/recriado errado | **High** | 2º PIX por atendimento | cap `(tenant_id, appointment_id)` sem filtro de status + teste `23505` após paga |
| FK composta sem alvo único | **Medium** | migration falha | 2.1 antes da tabela; alvos verificados (`profiles`, `appointments`) |
| `tenant_id` nulo sob service role | **Medium** | insert falha (fail-closed) | backfill passa `tenant_id` explícito; teste de insert sem tenant |
| Grant de escrita esquecido | **Medium** | cliente grava receita | `has_table_privilege` + tentativa de `insert`/`update`/`delete` sob `authenticated` |
| Cobrança paga com `amount_cents = 0` (D-02) | **Medium** | migration aborta | guarda com contagem e mensagem antes do insert; corrigir origem |
| FKs `restrict` quebram limpeza dos testes | **Medium** | suíte falha no `afterAll` | `cleanupPaymentFixtures` antes de `deleteTestUsers` |
| `voided_by` sem FK no DDL resumido (D-01) | **Medium** | ator cross-tenant na auditoria | constraint incluída conforme prosa; corrigir ADR no merge |
| Índice de consulta faltante | **Low** | KPI lento | RF-02 cobre catálogo dos 4 índices |
| Regra de domínio desatualizada | **Low** | decisão errada futura | BE-08 + grep negativo de “gera cobrança PIX” |

## 8. Comandos de verificação

Por task (integração, com stack local de `supabase db reset`):

```sh
npx supabase db reset
npm run test:integration -- tests/integration/security/appointment-payments-schema.test.ts
npm run test:integration -- tests/integration/security/appointment-payments-rls.test.ts
npm run test:integration -- tests/integration/security/appointment-payments-backfill.test.ts
```

Fechamento (BE-09):

```sh
npx supabase db reset && npx supabase db reset     # idempotência (RF-01)
npm test                                           # não regressão unitária
npm run test:integration                           # suíte de integração completa
grep -n "gera cobrança PIX" .agents/rules/dominio.md .kiro/steering/dominio.md   # esperado: sem resultado
grep -n "appointment_payments" .agents/rules/dominio.md .kiro/steering/dominio.md
```

## 9. Checklist de prontidão

- [ ] Todas as tasks têm dependência válida, sem ciclo.
- [ ] Toda task tem teste antes da implementação.
- [ ] Toda restrição da SPEC (I1–I10, §4, §5) tem teste explícito.
- [ ] Limpeza de fixtures definida antes de rodar a suíte.
- [ ] Diff restrito a migration, `tests/integration/**` e as duas regras de domínio.
