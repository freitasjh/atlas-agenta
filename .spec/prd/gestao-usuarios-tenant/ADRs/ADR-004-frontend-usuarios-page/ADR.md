# ADR-004 — Frontend: UsuariosPage (tabs Ativos/Convites) + useTenantUsers + sidebar por capacidade + route guards

- **Status**: planned
- **Data**: 2026-11-04
- **PRD**: gestao-usuarios-tenant (MVP — RF-01, RF-02, RF-06, RF-07; RNF-02, RNF-03, RNF-04)
- **Decisões cobertas**: D4 (visual por papel — sidebar+guards), D5 (tela única com tabs)
- **depends-on**: ADR-002, ADR-003

## Decisão

### 1. Tela única com tabs (D5-A)

- Renomear/evoluir `MembrosPage` → `UsuariosPage` em `/app/config/usuarios` (admin only), com duas tabs: **"Ativos"** (RF-01) e **"Convites"** (atual MembrosPage).
- Ao aceitar convite, profile aparece em "Ativos" (invalidar query do TanStack Query); convite aceito some dos pendentes (ou vai para histórico — fora do MVP).
- Item no `ConfigHub` renomeado de "Membros" para "Usuários" (evitar duplicação — relatório §13.5).
- Componentes shadcn/ui: Tabs, Table (desktop)/cards (mobile), Dialog de confirmação, Badge de status, Skeleton, StatePanel (empty/loading/error).
- Acessibilidade: `<caption sr-only>`, `<th scope="col">`, foco visível, teclado (RNF-03).

### 2. Hook `useTenantUsers()` (TanStack Query)

- Lê `profiles` do tenant sob RLS (`profiles_select_same_tenant`), selecionando `id, full_name, email, role, active, created_at, deactivated_at, deactivated_by`.
- Query key: `['tenant-users', tenantId]`. Sem filtro de `tenant_id` no cliente (RLS aplica).
- Mutations: `useUpdateUserName`, `useChangeUserRole`, `useDeactivateUser`, `useReactivateUser` — chamam as Edge Functions de ADR-002 (não tocam profiles direto).
- Invalidação granular por mutation (RNF-04).

### 3. Ações na tabela "Ativos"

- Editar nome (Dialog + input validado zod).
- Trocar papel (select + confirmação para mudanças críticas admin↔professional).
- Desativar/Reativar (botão com confirmação Dialog).
- Guards de UI: desabilitar desativar último admin ativo; desabilitar auto-rebaixamento/auto-desativação do próprio admin (ou confirmação forte). Trava real no servidor (ADR-002).
- Badge "Inativo" para `active=false`.

### 4. Sidebar por capacidade (D4-A)

- `AppSidebar` deriva itens de `usePermissions()` (capacidades por role). Uma única base de código.
- Mapa de navegação (relatório §8): admin vê tudo do tenant; professional vê Visão geral (própria), Agenda (própria), Clientes (leitura); receptionist vê Visão geral, Agenda (todos), Clientes, Configurações limitadas; nenhum vê Cobranças/Comissões/Pagamentos exceto admin.
- `DashboardPage` copy por papel ("Sua agenda" vs "Visão geral da empresa").

### 5. Route guards

- `RequireRole` por rota (já existe) estendido para professional/receptionist.
- Professional não acessa `/app/config/*` (exceto horários próprios) nem `/app/cobrancas` → redirect `/app` + toast.
- Receptionist não acessa `/app/cobrancas`, `/app/relatorios`, `/app/config/pagamentos`, `/app/config/membros` → redirect + toast.
- Guard `RequireAuth` + `active` (ADR-003) força logout se inativo.
- Checklist de rota no code review para não esquecer guard em rota nova (mitigação D4).

### 6. Convite integrado (RF-02)

- Aba "Convites" reusa componentes/Edge Functions existentes (invite-member, resend, revoke).
- `ProfessionalFormDialog`: botão "Convidar para acesso" (admin) quando `profile_id` null → abre dialog de convite pré-preenchido com `role=professional` + `professional_id` (ADR-005/ADR-002).
- UI do profissional: exibir "Acesso vinculado a: email" quando `profile_id` presente; botão "Revogar acesso" (desvincula — ADR-002 `unlink-professional-profile`).

### 7. Performance (RNF-04)

- Lista paginada se > 50 ou virtualizada.
- Índice `profiles_tenant_id_active_idx` (ADR-001).
- Invalidação granular (não refetch total).

## Interface congelada

### Rotas

| Rota | Guard | Papel |
|---|---|---|
| `/app/config/usuarios` | `RequireRole roles={["admin"]}` | admin |
| `/app/config/profissionais` (existente) | admin | admin |
| `/app/cobrancas` | `RequireRole roles={["admin"]}` | admin (exclui receptionist/professional) |
| `/app/relatorios` | `RequireRole roles={["admin"]}` | admin |
| `/app` (dashboard) | autenticado | todos |

### Hooks (contratos)

- `useTenantUsers(): { data: ProfileRow[], isLoading, error }` — lê profiles sob RLS.
- `useUpdateUserName(targetId, name): mutation`.
- `useChangeUserRole(targetId, newRole): mutation`.
- `useDeactivateUser(targetId): mutation`.
- `useReactivateUser(targetId): mutation`.
- `useUnlinkProfessional(professionalId): mutation`.

### Tipos

```ts
interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
  deactivated_by: string | null;
}
```

### Componentes

- `UsuariosPage` (renomeado de MembrosPage) com tabs "Ativos"/"Convites".
- `AtivosTab` (tabela/cards + ações).
- `ConvitesTab` (reuso de MembrosPage atual).
- `UserRow`, `EditNameDialog`, `ChangeRoleDialog`, `DeactivateDialog`.

## Alternativas consideradas

- **Rotas/layouts separados por role (B para D4)**: descartado — duplicação e drift (anti-padrão, relatório §3.2).
- **App dedicado por papel (C)**: descartado — overhead, fora de escopo.
- **Telas separadas Usuários + Convites (B para D5)**: descartado — fragmenta gestão de pessoas, contraria RF-02.
- **Drawer/modal único (C para D5)**: descartado — modal para seções de navegação é anti-padrão (NNG).

## Consequências

- Refatoração de `MembrosPage` → `UsuariosPage` (rename + tabs) — risco de regressão de convites; cobrir com testes.
- `AppSidebar` ganha lógica por capacidade — testar matriz de navegação por role (4 roles).
- Guards de rota: checklist de rota no code review.
- E-mail em profiles (ADR-001) habilita exibição direta sem Edge Function.
- Acessibilidade e responsividade (RNF-03, mobile-first).

## Fora desta decisão

- Schema/migrations → ADR-001.
- Edge Functions de mutação → ADR-002.
- Claim `active` no JWT → ADR-003.
- Onboarding por papel + auditoria UI → ADR-006 (fase 2).