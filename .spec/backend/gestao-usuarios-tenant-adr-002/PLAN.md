# Implementation Plan: ADR-002 (Edge Functions Privilegiadas)

## 1. Context & SPEC Traceability

- **Target Specification**: `.spec/backend/gestao-usuarios-tenant-adr-002/SPEC.md`
- **ADR de origem**: `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-002-edge-functions-privilegiadas/ADR.md`
- **Depende de:** ADR-001 (schema).
- **Goal**: Implementar Edge Functions privilegiadas (deactivate/reactivate/change-role/unlink) + modificar invite-member/accept-invitation, com validacao tenant, last-admin guard, revogacao de sessao, auditoria.

### 1.1 SPEC Validation Report

- **Status**: Validated (sem gaps criticos).
- **Identified Gaps/Warnings**:
  - Transacao multi-tabela (accept-invitation) requer cuidado; usar RPC security definer ou rollback manual.
  - Lock transacional para "ultimo admin" via SELECT FOR UPDATE ou advisory lock.
- **Assumptions Made**:
  - Edge Functions seguem padrao existente (invite-member handler.ts + index.ts + schemas.ts).
  - Service role para mutacoes privilegiadas (padrao do projeto).

## 2. Technical Strategy

### 2.1 Backend Strategy

- **Framework**: Supabase Edge Functions (Deno/TypeScript).
- **Padrao**: handler + schemas (zod) + index; service role para mutacoes; validacao tenant no handler.
- **Auditoria**: reusar audit_log (insert via service role).

### 2.2 Frontend Strategy

- N/A neste ADR (frontend em ADR-004).

### 2.3 Infrastructure Strategy

- Deploy das Edge Functions via `supabase functions deploy`.

## 3. Architecture Realization & Constraint Mapping

| SPEC Ref | Constraint | Enforcement Point | Failure Mode | Strategy |
|----------|------------|-------------------|--------------|----------|
| 2.1 | Multi-tenancy | Edge Function handler | Cross-tenant mutation | validar tenant_id do ator vs alvo |
| 2.1 | Last-admin guard | Lock transacional | Lockout | SELECT FOR UPDATE + count admins ativos |
| 2.1 | Revogacao de sessao | signOut('global') | Token stale | revogar apos mutacao |
| 2.5 | Vinculo tenant | Edge Function | Cross-tenant profile_id | validar professional.tenant_id == invitation.tenant_id |
| 2.6 | Transacao | accept-invitation | Inconsistencia | rollback manual / RPC |

## 4. Module & Code Structure

| Modulo | Responsabilidade | Boundary |
|--------|------------------|----------|
| supabase/functions/deactivate-user | Desativar usuario | Edge Function |
| supabase/functions/reactivate-user | Reativar usuario | Edge Function |
| supabase/functions/change-user-role | Mudar papel | Edge Function |
| supabase/functions/unlink-professional-profile | Desvincular | Edge Function |
| supabase/functions/invite-member | + professional_id | Edge Function (modificar) |
| supabase/functions/accept-invitation | + vinculo + email | Edge Function (modificar) |

## 5. Risks & Complexity

- **CRITICAL: Last-admin race condition** — mitigar com lock transacional.
- **HIGH: Token stale** — revogar sessoes apos mutacao; claim active fail-closed no hook (ADR-003).
- **MEDIUM: Transacao multi-tabela** — rollback manual ou RPC security definer.

## 6. Implementation Phases

### Phase 1: Edge Functions novas (deactivate, reactivate, change-role, unlink)

- Dependencies: ADR-001 (schema).
- Scope: 4 novas Edge Functions + schemas + tests.

### Phase 2: Modificar invite-member e accept-invitation

- Dependencies: Phase 1.
- Scope: adicionar professional_id + vinculacao + desnormalizacao email.

## 7. Critical Execution Path

EF-01 (deactivate) -> EF-02 (reactivate) -> EF-03 (change-role) -> EF-04 (unlink) -> EF-05 (invite-member) -> EF-06 (accept-invitation) -> IT-01..IT-06.

## 8. Atomic Task Breakdown

### Backend Tasks (Phase 1 — Edge Functions novas)

- **[EF-01]** [ ] Criar `deactivate-user` Edge Function
  - Depends on: ADR-001
  - Layer: Interface
  - Artifact: `supabase/functions/deactivate-user/{index.ts,handler.ts,schemas.ts}`
  - Enforcement: admin do tenant, last-admin guard, revogar sessoes, audit_log
  - Constraint Ref: SPEC 2.1

- **[EF-02]** [ ] Criar `reactivate-user` Edge Function
  - Depends on: EF-01
  - Layer: Interface
  - Artifact: `supabase/functions/reactivate-user/{index.ts,handler.ts,schemas.ts}`
  - Enforcement: admin do tenant, set active=true, audit_log
  - Constraint Ref: SPEC 2.2

- **[EF-03]** [ ] Criar `change-user-role` Edge Function
  - Depends on: EF-01
  - Layer: Interface
  - Artifact: `supabase/functions/change-user-role/{index.ts,handler.ts,schemas.ts}`
  - Enforcement: admin do tenant, last-admin guard, revogar sessoes, audit_log
  - Constraint Ref: SPEC 2.3

- **[EF-04]** [ ] Criar `unlink-professional-profile` Edge Function
  - Depends on: EF-01
  - Layer: Interface
  - Artifact: `supabase/functions/unlink-professional-profile/{index.ts,handler.ts,schemas.ts}`
  - Enforcement: admin do tenant, desvincular, audit_log
  - Constraint Ref: SPEC 2.4

### Backend Tasks (Phase 2 — Modificar existentes)

- **[EF-05]** [ ] Modificar `invite-member` para aceitar `professional_id`
  - Depends on: EF-01
  - Layer: Interface
  - Artifact: `supabase/functions/invite-member/{handler.ts,schemas.ts}`
  - Enforcement: validar tenant + professional nao vinculado
  - Constraint Ref: SPEC 2.5

- **[EF-06]** [ ] Modificar `accept-invitation` para vincular professional + desnormalizar email
  - Depends on: EF-05
  - Layer: Interface
  - Artifact: `supabase/functions/accept-invitation/handler.ts`
  - Enforcement: transacao (profile + professional.profile_id + email)
  - Constraint Ref: SPEC 2.6

### Backend Tasks (Phase 3 — Integration Tests)

- **[IT-01]** [ ] Teste deactivate-user (last-admin guard, revogacao)
- **[IT-02]** [ ] Teste reactivate-user
- **[IT-03]** [ ] Teste change-user-role (auditoria, revogacao)
- **[IT-04]** [ ] Teste unlink-professional-profile
- **[IT-05]** [ ] Teste invite-member com professional_id (validacao tenant)
- **[IT-06]** [ ] Teste accept-invitation (vinculacao + email)

## 9. Event Implementation Mapping

N/A (sem eventos).

## 10. Execution Readiness Checklist

- [ ] All tasks have valid dependencies.
- [ ] Edge Functions seguem padrao existente.
- [ ] Lock transacional para last-admin.
- [ ] Revogacao de sessao apos mutacao.
- [ ] Testes de integracao definidos.
