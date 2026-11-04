# Implementation Plan: ADR-003 (JWT Claim Active)

## 1. Context & SPEC Traceability

- **Target Specification**: `.spec/backend/gestao-usuarios-tenant-adr-003/SPEC.md`
- **ADR de origem**: `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-003-jwt-claim-active/ADR.md`
- **Depende de:** ADR-001 (schema: profiles.active).
- **Goal**: Emitir claim `active` no JWT (hook fail-closed para inativos) + parse frontend + guard de logout.

### 1.1 SPEC Validation Report

- **Status**: Validated (sem gaps criticos).
- **Assumptions Made**:
  - Hook custom-access-token existe (verificar se e SQL trigger ou Edge Function).
  - auth-claims.ts e useCurrentUser existem e parseiam claims.

## 2. Technical Strategy

### 2.1 Backend Strategy

- **Framework**: Supabase (hook custom-access-token, SQL ou Edge Function).
- **Padrao**: modificar hook para ler profiles.active e incluir na claim; falhar se inativo.

### 2.2 Frontend Strategy

- **Framework**: React + TypeScript.
- **Padrao**: parsear claim active em auth-claims.ts; expor em useCurrentUser; guard RequireAuth forca logout.

## 3. Architecture Realization & Constraint Mapping

| SPEC Ref | Constraint | Enforcement Point | Failure Mode | Strategy |
|----------|------------|-------------------|--------------|----------|
| 2 | Claim active fail-closed | Hook custom-access-token | Token emitido para inativo | hook falha se active !== true |
| 3 | Parse frontend | auth-claims.ts | active ausente tratado como true | default false (fail-closed) |
| 3 | Guard logout | RequireAuth | Usuario inativo permanece logado | forcar logout + redirect |

## 4. Module & Code Structure

| Modulo | Responsabilidade | Boundary |
|--------|------------------|----------|
| supabase/functions/custom-access-token (ou hook SQL) | Emitir claim active | Backend |
| src/lib/auth-claims.ts | Parsear claim active | Frontend |
| src/hooks/useCurrentUser.ts | Expor active | Frontend |
| src/app/guards/RequireAuth.tsx | Forcar logout se inativo | Frontend |

## 5. Risks & Complexity

- **CRITICAL: Hook fail-open** — se active ausente, tratar como false (fail-closed).
- **HIGH: Sessao antiga** — tokens emitidos antes do ADR-003 nao tem claim active; tratar ausencia como false (força re-login).
- **MEDIUM: Guard de logout** — evitar loop de redirect.

## 6. Implementation Phases

### Phase 1: Backend (hook custom-access-token)

- Dependencies: ADR-001 (schema: profiles.active).
- Scope: modificar hook para incluir active; falhar se inativo.

### Phase 2: Frontend (parse + guard)

- Dependencies: Phase 1.
- Scope: auth-claims.ts, useCurrentUser, RequireAuth.

## 7. Critical Execution Path

BE-01 (hook) -> FE-01 (parse) -> FE-02 (useCurrentUser) -> FE-03 (guard) -> IT-01 (hook test) -> IT-02 (frontend test).

## 8. Atomic Task Breakdown

### Backend Tasks (Phase 1)

- **[BE-01]** [ ] Modificar hook custom-access-token para incluir claim `active`
  - Depends on: ADR-001
  - Layer: Interface
  - Artifact: `supabase/functions/custom-access-token/handler.ts` (ou hook SQL)
  - Enforcement: ler profiles.active; falhar se active !== true
  - Constraint Ref: SPEC 2

- **[BE-02]** [ ] Atualizar profileRowSchema e buildHookClaims
  - Depends on: BE-01
  - Layer: Interface
  - Artifact: handler.ts
  - Enforcement: active: boolean no schema e nas claims
  - Constraint Ref: SPEC 2

### Frontend Tasks (Phase 2)

- **[FE-01]** [ ] Adicionar `active` ao tipo de claims e parser em auth-claims.ts
  - Depends on: BE-01
  - Layer: Frontend
  - Artifact: `src/lib/auth-claims.ts`
  - Enforcement: default false se ausente (fail-closed)
  - Constraint Ref: SPEC 3

- **[FE-02]** [ ] Expor `active` em useCurrentUser
  - Depends on: FE-01
  - Layer: Frontend
  - Artifact: `src/hooks/useCurrentUser.ts`
  - Enforcement: active = claims?.active ?? false
  - Constraint Ref: SPEC 3

- **[FE-03]** [ ] Forcar logout em RequireAuth se active === false
  - Depends on: FE-02
  - Layer: Frontend
  - Artifact: `src/app/guards/RequireAuth.tsx`
  - Enforcement: logout + redirect /login com mensagem
  - Constraint Ref: SPEC 3

### Integration Tasks (Phase 3)

- **[IT-01]** [ ] Teste hook: usuario ativo recebe claim active=true
- **[IT-02]** [ ] Teste hook: usuario inativo nao recebe token (falha)
- **[IT-03]** [ ] Teste frontend: active ausente -> false (fail-closed)
- **[IT-04]** [ ] Teste frontend: guard forca logout se active=false

## 9. Event Implementation Mapping

N/A (sem eventos).

## 10. Execution Readiness Checklist

- [ ] All tasks have valid dependencies.
- [ ] Hook fail-closed implementado.
- [ ] Frontend parse fail-closed.
- [ ] Guard de logout implementado.
- [ ] Testes definidos.
