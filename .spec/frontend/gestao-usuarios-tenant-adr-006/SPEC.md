# Architecture & Software Specification — ADR-006 (Auditoria + Onboarding por Papel)

**Feature slug:** `gestao-usuarios-tenant-adr-006`
**ADR de origem:** `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-006-auditoria-onboarding-por-papel/ADR.md`
**Depende de:** ADR-002 (acoes de audit emitidas), ADR-004 (UI base, redirect por papel).
**Escopo:** Frontend (pagina de auditoria do tenant + copy de onboarding por papel) + micro-ajuste backend (retornar role no accept).

## 1. Decisoes

- Reusar `audit_log` existente (sem tabela nova). Auditoria de usuarios e consumo/UI.
- Auditoria do tenant: nova pagina `/app/config/auditoria` (admin) com filtro "Usuarios" (nao mexer na AuditoriaPage do super_admin).
- Onboarding: copy de proximos passos por papel na pagina de aceite (invitation tem role; backend retorna role no accept). Redirect por papel ja existe (resolvePostLoginDestination, ADR-004) — apenas verificar com teste.
- Templates de e-mail por papel: FORA DESTA DECISAO (requer infra propria de e-mail; ver tech-debt convite-email-smtp). Documentado como diferido.

## 2. Acoes de audit cobertas (ja emitidas por ADR-002)

`invitation.created`, `invitation.accepted`, `invitation.revoked`, `invitation.resent`, `user.role_changed`, `user.deactivated`, `user.reactivated`, `professional.linked`, `professional.unlinked`.

## 3. Componentes

- `useUserAuditLog(filters)` hook (TanStack Query) lendo `audit_log` sob RLS com filtro por acoes de usuario (server-side `.in('action', [...])` + client-side por ator/periodo, padrao de useAuditLog).
- `AuditoriaTenantPage` (`/app/config/auditoria`, admin only): tabela/cards (quando, ator, acao, alvo) + filtro de acao + busca por ator + export CSV.
- `AcceptInvitationPage`: apos aceite, exibir copy de proximos passos por papel (professional/receptionist -> "entre e veja sua agenda"; admin -> "entre e gerencie sua empresa") antes do redirect /login. Backend retorna `role` no accept okResponse.
- Labels pt-BR por acao (mapa ACTION_LABELS).

## 4. Backend (micro-ajuste)

- `accept-invitation/handler.ts`: incluir `role` no okResponse ({ ok: true, role }). Idempotente no caminho accepted tambem.

## 5. Invariantes

| Entidade | Invariante |
|----------|------------|
| UI | Auditoria do tenant so lista acoes do proprio tenant (RLS, sem tenant_id do cliente). |
| Rota | /app/config/auditoria exige admin (RequireRole). |
| Copy | Copy por papel nao vaza acao de outro papel. |

## 6. Functional Requirements

- RF-11 (auditoria de usuarios, P3): pagina + filtro + CSV.
- RF-08 parcial (onboarding por papel, P2): copy por papel no aceite + redirect verificado. Templates de e-mail: diferido.

## 7. Delta Specs

- frontend-coding-standards.md: N/A.
- dominio.md: accept-invitation retorna role.

## 8. Criterios de Aceite

- Admin ve /app/config/auditoria com acoes de usuario do tenant; nao ve de outro tenant.
- Filtro por acao + busca por ator funcionam; CSV exporta o filtrado.
- Accept exibe copy por papel e redireciona /login; apos login, redirect por papel (teste).
- Testes de componente + a11y; typecheck + build verdes.
