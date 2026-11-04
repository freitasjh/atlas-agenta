# Architecture & Software Specification — ADR-004 (Frontend: UsuariosPage + Visual por Papel)

**Feature slug:** `gestao-usuarios-tenant-adr-004`
**ADR de origem:** `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-004-frontend-usuarios-page/ADR.md`
**Depende de:** ADR-002 (Edge Functions), ADR-003 (JWT claim active).
**Escopo:** Frontend (React + Vite + shadcn/ui + TanStack Query + react-router).

## 1. Decisoes (RESEARCH D4, D5)

- Visual por papel: sidebar por capacidades + guards de rota, base unica (sem apps separados).
- Gestao de usuarios: tela unica com tabs Ativos/Convites.

## 2. Rotas

- /app/config/usuarios (renomear/evoluir MembrosPage -> UsuariosPage). Admin only (guard RequireRole).
- Tabs: "Ativos" (profiles do tenant) e "Convites" (invitations).

## 3. Componentes

- UsuariosPage (tabs Ativos/Convites).
- AtivosTab: tabela/cards de profiles (nome, email, papel, status, desde) + acoes (editar nome, trocar papel, desativar/reativar).
- ConvitesTab: atual MembrosPage (convites) integrado.
- useTenantUsers hook (TanStack Query) lendo profiles do tenant sob RLS.

## 4. Sidebar por capacidade (AppSidebar)

- Professional: Visao geral (propria), Agenda (propria), Clientes (leitura), Horarios (proprios).
- Receptionist: Visao geral, Agenda, Clientes, (Configuracoes limitadas: nenhuma write de catalogo).
- Admin: tudo (como hoje).
- Remover de professional/receptionist: Cobrancas, Config (exceto horarios proprios), Membros/Usuarios, Pagamentos, WhatsApp, Mensagens, Servicos, Combos.

## 5. Route guards

- /app/cobrancas, /app/relatorios, /app/config/{servicos,combos,profissionais,whatsapp,pagamentos,mensagens,membros,usuarios} -> RequireRole(['admin']) (exceto profissionais/horarios para professional).
- /app/config/profissionais/:id/horarios -> ownership check (professional so os proprios).
- Professional tentando URL direta -> redirect /app + toast.

## 6. Redirect pos-login por papel

- professional -> /app/agenda.
- receptionist -> /app/agenda.
- admin -> /app.

## 7. Copy por papel

- Dashboard: professional ve "Sua agenda" / "Seus agendamentos"; admin/receptionist ve "Visao geral da empresa".

## 8. Invariantes

| Entidade | Invariante |
|----------|------------|
| UI | professional/receptionist nao veem menus financeiros/config admin. |
| Rota | professional nao acessa /app/config/* (exceto horarios proprios). |
| Rota | receptionist nao acessa /app/cobrancas, /app/relatorios, /app/config/pagamentos. |

## 9. Functional Requirements

- RF-01 (tela Usuarios), RF-02 (convites integrados), RF-06 (visual professional), RF-07 (visual receptionist).

## 10. Delta Specs

- frontend-coding-standards.md: sidebar por capacidade, route guards.
- dominio.md: N/A (frontend).

## 11. Criterios de Aceite

- Admin ve tela Usuarios (tabs Ativos/Convites) e gerencia profiles.
- Professional ve menu reduzido e so dados proprios; URL direta bloqueada.
- Receptionist ve agenda/clientes; financeiro bloqueado.
- Redirect pos-login por papel.
- Testes de componente + a11y.
