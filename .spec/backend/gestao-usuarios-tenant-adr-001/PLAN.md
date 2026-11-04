# Implementation Plan: ADR-001 (Schema: profiles.active/audit + invitations.professional_id)

## 1. Context & SPEC Traceability

- **Target Specification**: `.spec/backend/gestao-usuarios-tenant-adr-001/SPEC.md`
- **ADR de origem**: `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-001-schema-profiles-active-audit/ADR.md`
- **Goal**: Entregar migration aditiva + guard de colunas privilegiadas + indice + FK composta, com backfill idempotente e testes RLS.

### 1.1 SPEC Validation Report

- **Status**: Validated (sem gaps criticos).
- **Identified Gaps/Warnings**:
  - Transacao multi-tabela (accept-invitation) fica para ADR-002; este ADR so schema.
  - FK composta em professionals pode exigir ajuste se schema atual usa FK simples; validar na implementacao.
- **Assumptions Made**:
  - Guard trigger existente (`profiles_guard_privileged_columns`) sera estendido, nao recriado.
  - `email` desnormalizado e preenchido via backfill + trigger no signup/accept.

## 2. Technical Strategy

### 2.1 Backend Strategy

- **Framework**: Supabase (PostgreSQL + migrations versionadas em `supabase/migrations`).
- **Padrao**: migration aditiva (`alter table ... add column if not exists`), idempotente, com backfill.
- **RLS**: policies existentes mantidas; guard trigger estendido.

### 2.2 Frontend Strategy

- N/A neste ADR (frontend em ADR-004).

### 2.3 Infrastructure Strategy

- Migrations em `supabase/migrations/` com timestamp. Sem mudanca de infra.

## 3. Architecture Realization & Constraint Mapping

| SPEC Ref | Constraint | Enforcement Point | Failure Mode | Strategy |
|----------|------------|-------------------|--------------|----------|
| 5.1 | Multi-tenancy | RLS + tenant_id | Cross-tenant leak | policies existentes mantidas |
| 5.4 | Colunas privilegiadas | Guard trigger BEFORE UPDATE | Cliente burla active/role/email | estender guard |
| 5.1 | Backfill idempotente | Migration SQL | Re-run quebra | `if not exists` + `where ... is null` |
| 5.2 | Vinculo tenant | FK composta / validacao | Cross-tenant profile_id | FK composta (tenant, profile) |
| 5.5 | Invariantes | Constraints + tests | Dado inconsistente | constraints + integration tests |

## 4. Module & Code Structure

| Modulo | Responsabilidade | Boundary |
|--------|------------------|----------|
| supabase/migrations | Schema + RLS + guard + indices | DB |
| integration-test | RLS/guard tests | Testes |

## 5. Risks & Complexity

- **CRITICAL: Guard bypass** — se colunas novas nao entrarem no guard, cliente pode desativar a si mesmo ou alterar email de outro. Mitigacao: teste SQL com sessao authenticated.
- **HIGH: Backfill email** — auth.users pode nao ter email (anon); tratar null e validar.
- **MEDIUM: FK composta em professionals** — pode exigir ajuste de schema existente; validar.

## 6. Implementation Phases

### Phase 1: Migration (schema + guard + index + backfill)

- Dependencies: none.
- Scope: criar migration com alter table, index, backfill, guard trigger estendido, helper `current_user_is_active()`.

### Phase 2: Integration tests (RLS + guard)

- Dependencies: Phase 1.
- Scope: testes de isolamento cross-tenant, guard SQL, backfill.

## 7. Critical Execution Path

DB-01 (migration) -> DB-02 (guard) -> DB-03 (index/backfill) -> IT-01 (RLS) -> IT-02 (guard SQL).

## 8. Atomic Task Breakdown

### Backend Tasks (Phase 1 — Schema)

- **[DB-01]** [ ] Criar migration `profiles_active_audit.sql`
  - Depends on: None
  - Layer: Data
  - Artifact: migration file
  - Enforcement: colunas aditivas, idempotente
  - Constraint Ref: SPEC 5.1
  - Framework Detail: Supabase migration

- **[DB-02]** [ ] Estender guard trigger `profiles_guard_privileged_columns`
  - Depends on: DB-01
  - Layer: Data
  - Artifact: trigger function
  - Enforcement: bloqueia active/deactivated_*/role_changed_*/email para authenticated
  - Constraint Ref: SPEC 4

- **[DB-03]** [ ] Adicionar indice `profiles_tenant_id_active_idx`
  - Depends on: DB-01
  - Layer: Data
  - Artifact: index
  - Enforcement: performance de filtro por tenant+active
  - Constraint Ref: SPEC 5.1

- **[DB-04]** [ ] Backfill `email` em profiles (idempotente)
  - Depends on: DB-01
  - Layer: Data
  - Artifact: UPDATE statement
  - Enforcement: `where email is null`
  - Constraint Ref: SPEC 5.1

- **[DB-05]** [ ] Adicionar coluna `invitations.professional_id` + validacao tenant
  - Depends on: DB-01
  - Layer: Data
  - Artifact: migration
  - Enforcement: FK composta (tenant, profile) ou validacao service role
  - Constraint Ref: SPEC 5.2

- **[DB-06]** [ ] Garantir FK composta em `professionals.profile_id` (tenant match)
  - Depends on: DB-01
  - Layer: Data
  - Artifact: constraint
  - Enforcement: profile pertence ao mesmo tenant
  - Constraint Ref: SPEC 5.3

- **[DB-07]** [ ] Helper `current_user_is_active()` (security definer)
  - Depends on: DB-01
  - Layer: Data
  - Artifact: function
  - Enforcement: defesa em profundidade
  - Constraint Ref: SPEC 4

### Backend Tasks (Phase 2 — Integration Tests)

- **[IT-01]** [ ] Teste RLS: profile de outro tenant nao aparece
  - Depends on: DB-01..DB-07
  - Layer: Integration
  - Artifact: `*IT.java` (ou SQL test)
  - Enforcement: isolamento cross-tenant
  - Constraint Ref: RNF-01

- **[IT-02]** [ ] Teste guard SQL: authenticated nao altera colunas privilegiadas
  - Depends on: DB-02
  - Layer: Integration
  - Artifact: SQL test
  - Enforcement: guard bloqueia
  - Constraint Ref: RNF-01

- **[IT-03]** [ ] Teste backfill idempotente (re-run migration)
  - Depends on: DB-04
  - Layer: Integration
  - Artifact: test
  - Enforcement: sem duplicacao/erro
  - Constraint Ref: RNF-09

## 9. Event Implementation Mapping

N/A (sem eventos).

## 10. Execution Readiness Checklist

- [ ] All tasks have valid dependencies.
- [ ] Migration idempotente.
- [ ] Guard estendido.
- [ ] RLS tests definidos.
- [ ] Backfill validado.
