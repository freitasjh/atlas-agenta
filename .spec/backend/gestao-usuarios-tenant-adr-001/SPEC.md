# Architecture & Software Specification — ADR-001 (Schema: profiles.active/audit + invitations.professional_id)

**Feature slug:** `gestao-usuarios-tenant-adr-001`
**ADR de origem:** `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-001-schema-profiles-active-audit/ADR.md`
**PRD:** `.spec/prd/gestao-usuarios-tenant/PRD.md` (status: approved)
**RESEARCH:** `.spec/prd/gestao-usuarios-tenant/RESEARCH.md` (decisoes D1, D6)
**Escopo:** Backend/DB apenas (schema + RLS + guard + seed). Frontend fica em ADR-004.

## 1. ADRs referenciados

- ADR-001 (este): schema aditivo em `profiles`, `invitations`, `professionals`; guard de colunas privilegiadas; indice; FK composta.
- Decisoes: D1 (e-mail desnormalizado via trigger), D6 (guard trigger BEFORE UPDATE).

## 2. Bounded Context & Tenant Strategy

- **Bounded Context:** Identity & Access (tenant-scoped). Gerencia profiles (identidade de acesso) e convites, vinculados a tenant.
- **Tenant Strategy:** Row-level isolation via RLS (`current_tenant_id()`). Toda tabela de dominio tem `tenant_id` + indice + policy.
- **Provisioning:** migration aditiva; backfill `active=true` para profiles existentes; backfill `email` via join auth.users.

## 3. Identity & Access Management (IAM)

- **IdP:** Supabase Auth (JWT). Claims: `role`, `tenant_id`, `must_change_password`, `active` (a partir de ADR-003).
- **RBAC Matrix (este ADR nao altera roles):**

| Role | profiles (read) | profiles (update) | invitations | professionals |
|------|-----------------|-------------------|-------------|---------------|
| super_admin | todos (cross-tenant) | todos | todos | todos |
| admin | mesmo tenant (incl. inativos) | full_name, email (proprio); role/active via Edge Function | CRUD do tenant | CRUD do tenant |
| professional | proprio | full_name, email (proprio) | - | leitura propria |
| receptionist | proprio | full_name, email (proprio) | - | leitura |

- **Trava real:** RLS + guard trigger. UI e defesa em profundidade.

## 4. Seguranca & Colunas Privilegiadas

- **Guard de colunas privilegiadas** (`profiles_guard_privileged_columns`): estender para `active`, `deactivated_at`, `deactivated_by`, `role_changed_at`, `role_changed_by`, `email`. Cliente (authenticated) so pode alterar `full_name` (e campos nao-privilegiados). Tentativa de alterar privilegiado -> RAISE EXCEPTION.
- **RLS policies existentes mantidas.** Adicionar helper `current_user_is_active()` (security definer) para uso em policies sensíveis (defesa em profundidade).

## 5. Data Model & Concurrency

### 5.1 Migration aditiva: `profiles`

```sql
alter table profiles
  add column if not exists active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references profiles(id),
  add column if not exists role_changed_at timestamptz,
  add column if not exists role_changed_by uuid references profiles(id),
  add column if not exists email text;

create index if not exists profiles_tenant_id_active_idx
  on profiles (tenant_id, active);

-- backfill email (idempotente)
update profiles p
   set email = u.email
  from auth.users u
 where p.id = u.id and p.email is null;

-- trigger desnormalizacao no signup (handle_new_user) e accept-invitation
```

### 5.2 Migration aditiva: `invitations`

```sql
alter table invitations
  add column if not exists professional_id uuid references professionals(id);
```

### 5.3 Migration aditiva: `professionals`

```sql
-- garantir que profile_id pertence ao mesmo tenant (FK composta ou validacao na Edge Function)
```

### 5.4 Guard trigger (estender)

```sql
-- BEFORE UPDATE on profiles: bloquear alteracao de colunas privilegiadas
-- por sessao authenticated. service role (Edge Functions) bypassa.
```

### 5.5 Invariantes (PBT)

| Entidade | Invariante | Descricao |
|----------|------------|-----------|
| profiles | active default true | Todo profile existente tem active=true apos backfill |
| profiles | tenant required | role != super_admin -> tenant_id not null |
| profiles | email not null after backfill | Apos migration, todo profile tem email |
| invitations | professional_id tenant match | Se professional_id not null, professional.tenant_id = invitation.tenant_id |
| professionals | profile_id tenant match | Se profile_id not null, profile.tenant_id = professional.tenant_id |

### 5.6 Concorrencia

- Ultimo admin ativo: lock transacional (`SELECT ... FOR UPDATE` ou advisory lock) na Edge Function (ADR-002). Schema nao impoe (constraint complexa); validacao na aplicacao + teste de concorrencia.

## 6. Event Model

N/A (sem eventos assincronos neste ADR; mutacoes sincronas via Edge Functions).

## 7. Functional Requirements (subset ADR-001)

- RF-01 (schema): profiles com active/email/audit; invitations.professional_id.
- RNF-01 (isolamento): RLS mantido; guard estendido.
- RNF-09 (migracao): aditiva, backfill idempotente.

## 8. Delta Specs

- `.agents/rules/dominio.md`: adicionar campos active/deactivated/role_changed/email em profiles; invitations.professional_id; professionals.profile_id tenant match.
- `.agents/rules/seguranca-multitenant.md`: guard de colunas privilegiadas estendido.

## 9. Criterios de Aceite (ADR-001)

- Migration aplica sem erro em DB limpo e em DB com dados existentes (backfill).
- Guard bloqueia alteracao de colunas privilegiadas por sessao authenticated (teste SQL).
- Indice `profiles_tenant_id_active_idx` existe.
- FK/validacao tenant para invitations.professional_id e professionals.profile_id.
- Suite de testes (unit + integration) verde.
- RLS tests: profile de outro tenant nao aparece/edita.
