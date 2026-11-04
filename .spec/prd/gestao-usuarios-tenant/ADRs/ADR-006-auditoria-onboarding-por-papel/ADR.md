# ADR-006 — Auditoria/onboarding por papel + redirect pós-login (RF-08/RF-11, fase 2 pós-MVP)

- **Status**: planned (fase 2 — fora do MVP; executar após merge de ADR-001..005)
- **Data**: 2026-11-04
- **PRD**: gestao-usuarios-tenant (P2/P3 — RF-08, RF-11; RNF-05)
- **Decisões cobertas**: (consolida padrões P7, P8 do relatório §3.1)
- **depends-on**: ADR-004

## Nota de escopo

Este ADR está **fora do MVP** (PRD §7 exclui RF-08–RF-11). Mantido como ADR separado (não consolidado com ADR-005) por ter ciclo de release distinto (UI de auditoria/onboarding não bloqueia a entrega de gestão de usuários). Teto de 5 ADRs/PRD (🟡 processo) é excedido; decisão documentada no ADR-INDEX ("manter 6, ADR-006 = fase 2"). Se o gate humano preferir, dividir em PRD separado `gestao-usuarios-tenant-auditoria`.

## Decisão

### 1. Auditoria de usuários (RF-11, P3)

- Reusar `AuditoriaPage` (admin) filtrando ações de usuário, ou criar aba "Usuários" no audit.
- Eventos (já emitidos por ADR-002): `invitation.created`, `invitation.accepted`, `invitation.revoked`, `invitation.expired`, `user.role_changed`, `user.deactivated`, `user.reactivated`, `professional.linked`, `professional.unlinked`.
- Filtro por tenant (RLS `audit_log_select_tenant_admin`); super_admin vê cross-tenant (auditado).
- Export CSV opcional.

### 2. Onboarding por papel (RF-08, P2)

- Template de e-mail do invite-member por role:
  - professional: "Você foi convidado como profissional — após aceitar, veja sua agenda."
  - receptionist: "…sua agenda e clientes."
  - admin: "…gerenciar a empresa."
- Página `accept-invitation`: após aceite, redirect por role (professional/receptionist → `/app/agenda`; admin → `/app`).
- `resolvePostLoginDestination` considera role (já existe hook; ajustar).
- Onboarding checklist leve no primeiro acesso por role (P3, opcional).

### 3. Ações de audit_log (já congeladas em ADR-002)

Nenhuma nova ação; apenas consumo/UI. Novas ações só se necessário (documentar em TASKS).

## Interface congelada

### Rotas

- `/app/config/auditoria` (existente, admin) — adicionar filtro/aba "Usuários".

### Hooks

- `useUserAuditLog(filters): { data, isLoading }` — lê `audit_log` sob RLS com filtro por ações de usuário.

### Redirect

- `resolvePostLoginDestination(role, ...)` retorna:
  - `professional` / `receptionist` → `/app/agenda`
  - `admin` / `super_admin` → `/app`

## Alternativas consideradas

- **Auditoria em tabela separada**: descartado — reusar `audit_log` existente (RNF-05, menos superfície).
- **Onboarding como fluxo bloqueante**: descartado — checklist leve, não bloqueia uso.

## Consequências

- Depende de ADR-002 (ações já emitidas) e ADR-004 (UI base).
- Não bloqueia MVP.
- Export CSV opcional (decisão na TASKS).

## Fora desta decisão

- Emissão de ações de audit → ADR-002.
- UI de gestão base → ADR-004.