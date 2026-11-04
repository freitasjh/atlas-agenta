# Implementation Plan: ADR-005 (Vinculo Profissional <-> Login)

## 1. Context & SPEC Traceability

- **Target Specification**: `.spec/frontend/gestao-usuarios-tenant-adr-005/SPEC.md`
- **ADR de origem**: `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-005-vinculo-profissional-login/ADR.md`
- **Depende de:** ADR-001 (schema), ADR-002 (Edge Functions).
- **Goal**: Entregar UX de vinculo profissional<->login (convite pre-cadastrado + revogacao de acesso) no frontend.

### 1.1 SPEC Validation Report

- **Status**: Validated (sem gaps criticos).
- **Assumptions Made**:
  - Edge Functions invite-member, accept-invitation, unlink-professional-profile ja existem (ADR-002).
  - ProfessionalFormDialog ja exibe "Acesso" somente-leitura (profile_id).
  - Convidar para acesso reusa dialog de convite (email, role=professional, professional_id).

## 2. Technical Strategy

### 2.1 Frontend Strategy

- **Framework**: React 18 + TypeScript + Vite.
- **UI**: shadcn/ui (Dialog, Button, Badge, Input, Label, Select).
- **State**: TanStack Query (useProfessionals, useInvitations).
- **i18n/a11y**: padrao do projeto (pt-BR literals, foco, labels).

## 3. Architecture Realization & Constraint Mapping

| SPEC Ref | Constraint | Enforcement Point | Failure Mode | Strategy |
|----------|------------|-------------------|--------------|----------|
| 2 | UI por papel | ProfissionaisPage | Botao aparece para nao-admin | guard isAdmin |
| 3 | Vinculo tenant | Edge Function invite-member | Cross-tenant professional_id | validacao server-side |
| 4 | Revogacao | unlink-professional-profile | Desvincular sem confirmacao | Dialog de confirmacao |

## 4. Module & Code Structure

| Modulo | Responsabilidade | Boundary |
|--------|------------------|----------|
| src/app/config/profissionais/ProfissionaisPage.tsx | Lista + botao convidar | Frontend |
| src/app/config/profissionais/ProfessionalFormDialog.tsx | Exibir vinculo + revogar | Frontend |
| src/app/config/profissionais/ConviteProfissionalDialog.tsx | Dialog de convite pre-preenchido | Frontend |
| src/hooks/useInvitations.ts | useInviteMember (ja existe) | Frontend |

## 5. Risks & Complexity

- **CRITICAL: Cross-tenant professional_id** — validacao server-side (Edge Function).
- **HIGH: UX de vinculo** — feedback claro de "convite enviado", "acesso vinculado", "acesso revogado".
- **MEDIUM: A11y** — dialogs com foco, labels, confirmacao.

## 6. Implementation Phases

### Phase 1: Botao "Convidar para acesso" + dialog pre-preenchido

- Dependencies: ADR-002 (Edge Functions).
- Scope: ProfissionaisPage + ConviteProfissionalDialog.

### Phase 2: Exibicao de vinculo + revogar acesso

- Dependencies: Phase 1.
- Scope: ProfessionalFormDialog (exibir vinculo + botao revogar).

## 7. Critical Execution Path

FE-01 (botao) -> FE-02 (dialog convite) -> FE-03 (exibir vinculo) -> FE-04 (revogar) -> IT-01..IT-04.

## 8. Atomic Task Breakdown

### Frontend Tasks (Phase 1)

- **[FE-01]** [ ] Adicionar botao "Convidar para acesso" em ProfissionaisPage (admin, profile_id null)
  - Depends on: ADR-002
  - Layer: Frontend
  - Artifact: `src/app/config/profissionais/ProfissionaisPage.tsx`
  - Enforcement: admin only; profile_id null
  - Constraint Ref: SPEC 2

- **[FE-02]** [ ] Criar `ConviteProfissionalDialog` (email, role=professional, professional_id)
  - Depends on: FE-01
  - Layer: Frontend
  - Artifact: `src/app/config/profissionais/ConviteProfissionalDialog.tsx`
  - Enforcement: pre-preenchido, valida email, chama invite-member
  - Constraint Ref: SPEC 2

### Frontend Tasks (Phase 2)

- **[FE-03]** [ ] Exibir "Acesso vinculado a: email" em ProfessionalFormDialog quando profile_id presente
  - Depends on: FE-02
  - Layer: Frontend
  - Artifact: `src/app/config/profissionais/ProfessionalFormDialog.tsx`
  - Enforcement: somente leitura
  - Constraint Ref: SPEC 2

- **[FE-04]** [ ] Adicionar botao "Revogar acesso" (admin) com Dialog de confirmacao
  - Depends on: FE-03
  - Layer: Frontend
  - Artifact: `src/app/config/profissionais/ProfessionalFormDialog.tsx`
  - Enforcement: chama unlink-professional-profile; confirmação
  - Constraint Ref: SPEC 2

### Frontend Tasks (Phase 3 — Tests)

- **[IT-01]** [ ] Teste botao "Convidar para acesso" (admin, profile_id null)
- **[IT-02]** [ ] Teste ConviteProfissionalDialog (envio, validacao)
- **[IT-03]** [ ] Teste exibicao de vinculo + revogar acesso
- **[IT-04]** [ ] Teste a11y (dialogs, foco, labels)

## 9. Event Implementation Mapping

N/A (sem eventos).

## 10. Execution Readiness Checklist

- [ ] All tasks have valid dependencies.
- [ ] Botao "Convidar para acesso" implementado.
- [ ] ConviteProfissionalDialog implementado.
- [ ] Exibicao de vinculo implementada.
- [ ] Revogar acesso implementado.
- [ ] Testes definidos.
