# Implementation Plan: ADR-004 (Frontend: UsuariosPage + Visual por Papel)

## 1. Context & SPEC Traceability

- **Target Specification**: `.spec/frontend/gestao-usuarios-tenant-adr-004/SPEC.md`
- **ADR de origem**: `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-004-frontend-usuarios-page/ADR.md`
- **Depende de:** ADR-002 (Edge Functions), ADR-003 (JWT claim active).
- **Goal**: Entregar tela de Usuarios (tabs Ativos/Convites) + sidebar por capacidade + route guards + redirect por papel + copy por papel.

### 1.1 SPEC Validation Report

- **Status**: Validated (sem gaps criticos).
- **Assumptions Made**:
  - MembrosPage sera evoluido para UsuariosPage (rename/evolucao, nao nova tela).
  - useTenantUsers lera profiles do tenant sob RLS (select_same_tenant).
  - Edge Functions ja existem (deactivate, change-role, etc.) — chamar via supabase.functions.invoke.

## 2. Technical Strategy

### 2.1 Frontend Strategy

- **Framework**: React 18 + TypeScript + Vite.
- **UI**: shadcn/ui (Table, Tabs, Badge, Dialog, Select, Skeleton).
- **State**: TanStack Query (useTenantUsers).
- **Router**: react-router v6 (createBrowserRouter, RequireRole guard).
- **i18n**: react-i18next (pt-BR default).

## 3. Architecture Realization & Constraint Mapping

| SPEC Ref | Constraint | Enforcement Point | Failure Mode | Strategy |
|----------|------------|-------------------|--------------|----------|
| 4 | UI por papel | AppSidebar + usePermissions | Menu errado por role | filtrar items por capacidades |
| 5 | Route guards | RequireRole + ownership | Acesso direto a rota proibida | redirect + toast |
| 6 | Redirect por papel | resolvePostLoginDestination | Redirect errado | mapear role -> destino |
| 2 | RLS | useTenantUsers | Cross-tenant leak | RLS select_same_tenant |

## 4. Module & Code Structure

| Modulo | Responsabilidade | Boundary |
|--------|------------------|----------|
| src/app/config/usuarios/UsuariosPage.tsx | Tela de usuarios (tabs) | Frontend |
| src/hooks/useTenantUsers.ts | Hook de leitura de profiles | Frontend |
| src/components/AppSidebar.tsx | Sidebar por capacidade | Frontend |
| src/app/guards/RequireRole.tsx | Guard de papel | Frontend |
| src/auth/resolvePostLoginDestination.ts | Redirect por papel | Frontend |

## 5. Risks & Complexity

- **CRITICAL: Cross-tenant leak** — RLS e a trava; UI e defesa em profundidade.
- **HIGH: Guard de rota** — professional nao pode acessar config admin.
- **MEDIUM: A11y** — tabela com caption sr-only, cards no mobile.

## 6. Implementation Phases

### Phase 1: Hook useTenantUsers + UsuariosPage (tabs)

- Dependencies: ADR-002 (Edge Functions), ADR-003 (claim active).
- Scope: criar useTenantUsers, UsuariosPage com tabs Ativos/Convites, AtivosTab com acoes.

### Phase 2: Sidebar por capacidade + route guards + redirect

- Dependencies: Phase 1.
- Scope: AppSidebar filtrado, RequireRole em rotas, resolvePostLoginDestination por papel, copy por papel.

## 7. Critical Execution Path

FE-01 (hook) -> FE-02 (UsuariosPage) -> FE-03 (AtivosTab) -> FE-04 (sidebar) -> FE-05 (guards) -> FE-06 (redirect) -> IT-01..IT-06.

## 8. Atomic Task Breakdown

### Frontend Tasks (Phase 1)

- **[FE-01]** [ ] Criar hook `useTenantUsers`
  - Depends on: ADR-002
  - Layer: Frontend
  - Artifact: `src/hooks/useTenantUsers.ts`
  - Enforcement: ler profiles do tenant sob RLS; TanStack Query
  - Constraint Ref: SPEC 3

- **[FE-02]** [ ] Renomear/evoluir `MembrosPage` -> `UsuariosPage` com tabs Ativos/Convites
  - Depends on: FE-01
  - Layer: Frontend
  - Artifact: `src/app/config/usuarios/UsuariosPage.tsx`
  - Enforcement: admin only; tabs Ativos/Convites
  - Constraint Ref: SPEC 2

- **[FE-03]** [ ] Implementar `AtivosTab` (tabela/cards + acoes)
  - Depends on: FE-02
  - Layer: Frontend
  - Artifact: `src/app/config/usuarios/AtivosTab.tsx`
  - Enforcement: editar nome, trocar papel, desativar/reativar (via Edge Functions)
  - Constraint Ref: SPEC 3

- **[FE-04]** [ ] Integrar `ConvitesTab` (atual MembrosPage)
  - Depends on: FE-02
  - Layer: Frontend
  - Artifact: `src/app/config/usuarios/ConvitesTab.tsx`
  - Enforcement: convites por email + papel
  - Constraint Ref: SPEC 3

### Frontend Tasks (Phase 2)

- **[FE-05]** [ ] Filtrar `AppSidebar` por capacidades (professional/receptionist)
  - Depends on: FE-02
  - Layer: Frontend
  - Artifact: `src/components/AppSidebar.tsx`
  - Enforcement: menu reduzido por role
  - Constraint Ref: SPEC 4

- **[FE-06]** [ ] Adicionar `RequireRole` guards em rotas financeiras/config
  - Depends on: FE-05
  - Layer: Frontend
  - Artifact: `src/router.tsx`
  - Enforcement: professional/receptionist bloqueados de rotas proibidas
  - Constraint Ref: SPEC 5

- **[FE-07]** [ ] Ownership check em horarios (professional so proprios)
  - Depends on: FE-06
  - Layer: Frontend
  - Artifact: `src/app/config/profissionais/horarios/HorariosPage.tsx`
  - Enforcement: professional so edita horarios proprios
  - Constraint Ref: SPEC 5

- **[FE-08]** [ ] Redirect pos-login por papel (resolvePostLoginDestination)
  - Depends on: FE-05
  - Layer: Frontend
  - Artifact: `src/auth/resolvePostLoginDestination.ts`
  - Enforcement: professional/receptionist -> /app/agenda; admin -> /app
  - Constraint Ref: SPEC 6

- **[FE-09]** [ ] Copy por papel no Dashboard
  - Depends on: FE-08
  - Layer: Frontend
  - Artifact: `src/app/dashboard/DashboardPage.tsx`
  - Enforcement: professional ve "Sua agenda"
  - Constraint Ref: SPEC 7

### Frontend Tasks (Phase 3 — Tests)

- **[IT-01]** [ ] Teste useTenantUsers (RLS, loading, error)
- **[IT-02]** [ ] Teste UsuariosPage (tabs, acoes, guards)
- **[IT-03]** [ ] Teste AppSidebar (menu por role)
- **[IT-04]** [ ] Teste route guards (professional/receptionist bloqueados)
- **[IT-05]** [ ] Teste redirect pos-login por papel
- **[IT-06]** [ ] Teste a11y (tabela, cards, foco)

## 9. Event Implementation Mapping

N/A (sem eventos).

## 10. Execution Readiness Checklist

- [ ] All tasks have valid dependencies.
- [ ] Hook useTenantUsers implementado.
- [ ] UsuariosPage com tabs implementado.
- [ ] Sidebar por capacidade implementado.
- [ ] Route guards implementados.
- [ ] Redirect por papel implementado.
- [ ] Testes definidos.
