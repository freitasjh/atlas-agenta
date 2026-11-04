# Implementation Plan: ADR-006 (Auditoria + Onboarding por Papel)

## 1. Context & SPEC Traceability

- **Target Specification**: `.spec/frontend/gestao-usuarios-tenant-adr-006/SPEC.md`
- **ADR de origem**: `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-006-auditoria-onboarding-por-papel/ADR.md`
- **Depende de:** ADR-002 (acoes emitidas), ADR-004 (UI base, redirect).
- **Goal**: Pagina de auditoria do tenant (filtro Usuarios + CSV) + copy de onboarding por papel no aceite + verificacao do redirect por papel.

### 1.1 SPEC Validation Report

- **Status**: Validated (sem gaps criticos).
- **Assumptions Made**:
  - RLS `audit_log_select_tenant_admin` permite admin do tenant ler acoes do proprio tenant (padrao de useAuditLog).
  - accept-invitation pode incluir `role` no okResponse sem quebrar clientes (campo aditivo, zod tolerante no frontend).
  - Templates de e-mail por papel: diferido (fora de escopo).

## 2. Technical Strategy

### 2.1 Backend Strategy

- **Framework**: Supabase Edge Function (Deno). Micro-ajuste aditivo em accept-invitation (retornar role).

### 2.2 Frontend Strategy

- **Framework**: React 18 + TypeScript + Vite; shadcn/ui (Table, Select, Input, Button, Skeleton); TanStack Query; react-router; CSV via Blob download.

## 3. Architecture Realization & Constraint Mapping

| SPEC Ref | Constraint | Enforcement Point | Failure Mode | Strategy |
|----------|------------|-------------------|--------------|----------|
| 3 | RLS tenant | useUserAuditLog (sem tenant_id do cliente) | Cross-tenant leak | RLS select_tenant_admin |
| 3 | Route guard | RequireRole(['admin']) | Nao-admin acessa auditoria | redirect + toast |
| 4 | Contrato aditivo | accept okResponse + role | Cliente antigo quebra | campo opcional, zod tolerante |

## 4. Module & Code Structure

| Modulo | Responsabilidade | Boundary |
|--------|------------------|----------|
| src/hooks/useUserAuditLog.ts | Hook de leitura filtrada | Frontend |
| src/app/config/auditoria/AuditoriaTenantPage.tsx | Pagina de auditoria do tenant | Frontend |
| src/app/config/auditoria/auditLabels.ts | Labels pt-BR por acao | Frontend |
| src/app/accept-invitation/AcceptInvitationPage.tsx | Copy por papel | Frontend |
| supabase/functions/accept-invitation/handler.ts | Retornar role | Backend |

## 5. Risks & Complexity

- **HIGH: Cross-tenant leak** — RLS e a trava; UI defesa em profundidade.
- **MEDIUM: CSV com PII** — export inclui emails; avisar na UI ("contém dados pessoais").
- **LOW: Contrato accept** — campo aditivo, sem quebra.

## 6. Implementation Phases

### Phase 1: Backend (role no accept) + hook useUserAuditLog

- Dependencies: ADR-002.
- Scope: okResponse com role; hook com filtro por acoes de usuario.

### Phase 2: Pagina de auditoria do tenant + CSV

- Dependencies: Phase 1.
- Scope: AuditoriaTenantPage + rota + labels + CSV.

### Phase 3: Copy por papel no aceite + verificacao redirect

- Dependencies: Phase 1.
- Scope: AcceptInvitationPage copy por role; teste de redirect por papel.

## 7. Critical Execution Path

BE-01 (role no accept) -> FE-01 (hook) -> FE-02 (pagina) -> FE-03 (CSV) -> FE-04 (copy) -> IT-01..IT-04.

## 8. Atomic Task Breakdown

### Backend Tasks (Phase 1)

- **[BE-01]** [ ] Incluir `role` no okResponse de accept-invitation (caminho pending + accepted)
  - Depends on: ADR-002
  - Layer: Interface
  - Artifact: `supabase/functions/accept-invitation/handler.ts`
  - Enforcement: campo aditivo; teste deno
  - Constraint Ref: SPEC 4

### Frontend Tasks (Phase 1-2)

- **[FE-01]** [ ] Criar hook `useUserAuditLog`
  - Depends on: BE-01
  - Layer: Frontend
  - Artifact: `src/hooks/useUserAuditLog.ts`
  - Enforcement: ler audit_log sob RLS; filtro server-side por acoes de usuario; client-side por ator/periodo
  - Constraint Ref: SPEC 3

- **[FE-02]** [ ] Criar `AuditoriaTenantPage` (tabela/cards + filtro de acao + busca por ator)
  - Depends on: FE-01
  - Layer: Frontend
  - Artifact: `src/app/config/auditoria/AuditoriaTenantPage.tsx`
  - Enforcement: admin only; loading/error/empty; a11y
  - Constraint Ref: SPEC 3

- **[FE-03]** [ ] Export CSV do filtrado (Blob download, aviso de PII)
  - Depends on: FE-02
  - Layer: Frontend
  - Artifact: `src/app/config/auditoria/AuditoriaTenantPage.tsx` (ou lib csv)
  - Enforcement: exporta o que esta filtrado; UTF-8 BOM para Excel
  - Constraint Ref: SPEC 3

- **[FE-04]** [ ] Registrar rota `/app/config/auditoria` (admin) + atalho no ConfigHub
  - Depends on: FE-02
  - Layer: Frontend
  - Artifact: `src/router.tsx`, `src/app/config/ConfigHubPage.tsx`
  - Enforcement: RequireRole(['admin'])
  - Constraint Ref: SPEC 3

### Frontend Tasks (Phase 3)

- **[FE-05]** [ ] Copy de proximos passos por papel em AcceptInvitationPage
  - Depends on: BE-01
  - Layer: Frontend
  - Artifact: `src/app/accept-invitation/AcceptInvitationPage.tsx`
  - Enforcement: role do accept response; fallback generico se ausente
  - Constraint Ref: SPEC 3

### Tests (Phase 4)

- **[IT-01]** [ ] Teste useUserAuditLog (filtro, loading, error)
- **[IT-02]** [ ] Teste AuditoriaTenantPage (render, filtro, CSV, guard)
- **[IT-03]** [ ] Teste AcceptInvitationPage copy por papel
- **[IT-04]** [ ] Teste redirect pos-login por papel (ja existe? complementar)

## 9. Event Implementation Mapping

N/A (sem eventos).

## 10. Execution Readiness Checklist

- [ ] All tasks have valid dependencies.
- [ ] Hook filtrado por acoes de usuario.
- [ ] Pagina admin only.
- [ ] CSV com aviso de PII.
- [ ] Copy por papel com fallback.
- [ ] Testes definidos.
