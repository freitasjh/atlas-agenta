# ADR-001 — Schema: profiles.active/audit + email + invitations.professional_id + guard trigger estendido

- **Status**: planned
- **Data**: 2026-11-04
- **PRD**: gestao-usuarios-tenant (MVP — RF-01, RF-03, RF-04; RNF-01, RNF-09)
- **Decisões cobertas**: D1 (e-mail desnormalizado via trigger), D6 (guard trigger estendido)
- **depends-on**: —

## Decisão

Migration aditiva em `profiles` e `invitations`, sem quebra de contrato, com backfill `active=true`:

1. **`profiles` — colunas novas** (todas nullable ou com default; aditivas):
   - `email text` (desnormalizado; populado por trigger, nunca editável pelo cliente).
   - `active boolean not null default true` (soft delete / desativação).
   - `deactivated_at timestamptz null`, `deactivated_by uuid null references profiles(id)`.
   - `role_changed_at timestamptz null`, `role_changed_by uuid null`.
   - (Opcional, se útil) `updated_at timestamptz not null default now()` — só se não existir; reusar `created_at` se já cobrir.
2. **Trigger `handle_new_user`** (existente, migration `20250216092000`): passa a popular `profiles.email` a partir de `auth.users.email` no signup. `accept-invitation` atualiza `email` quando o profile é criado/atualizado (service role, bypassa guard).
3. **Backfill**: `update profiles set email = (select email from auth.users u where u.id = profiles.id), active = coalesce(active, true)` para profiles existentes. Idempotente.
4. **`invitations.professional_id uuid null references professionals(id)`** (convite vinculado a profissional pré-cadastrado). Nullable para convites sem vínculo (admin/receptionist).
5. **Guard trigger estendido** (`profiles_guard_privileged_columns`, migration `20250228091500`): adicionar à lista de colunas barradas para `auth.role() = 'authenticated'`: `email`, `active`, `deactivated_at`, `deactivated_by`, `role_changed_at`, `role_changed_by` (além de `id`, `role`, `tenant_id`, `must_change_password`). Comparação `OLD vs NEW` (SQLSTATE `insufficient_privilege` / `privileged_column_change_denied`). Service role e funções security definer executadas por esses papéis bypassam (auth.role() ≠ authenticated).
6. **Índice** `profiles_tenant_id_active_idx on profiles (tenant_id, active)` para RNF-04.
7. **FK composta (tenant)** para vínculo profile↔professional: adicionar constraint `profiles_tenant_id_id_unique unique (tenant_id, id)` (permite null tenant para super_admin — Postgres trata nulls como distintos) e alterar `professionals.profile_id` FK para composta `(tenant_id, profile_id) references profiles (tenant_id, id)` com `on delete set null`. Garante que um professional só se vincule a profile do mesmo tenant (mitiga drift cross-tenant).
8. **Grant de coluna** (fronteira principal): `authenticated` não tem UPDATE nas colunas privilegiadas (já padrão do projeto; estender para as novas). Trigger é barreira redundante (defesa em profundidade).

## Interface congelada

### Schema (SQL)

```sql
-- profiles (aditivo)
alter table public.profiles
  add column if not exists email text,
  add column if not exists active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.profiles (id),
  add column if not exists role_changed_at timestamptz,
  add column if not exists role_changed_by uuid references public.profiles (id);

create index if not exists profiles_tenant_id_active_idx
  on public.profiles (tenant_id, active);

alter table public.profiles
  add constraint profiles_tenant_id_id_unique unique (tenant_id, id);

-- invitations (aditivo)
alter table public.invitations
  add column if not exists professional_id uuid references public.professionals (id) on delete set null;

create index if not exists invitations_professional_id_idx
  on public.invitations (professional_id);

-- professionals: FK composta
alter table public.professionals
  drop constraint if exists professionals_profile_id_fkey;
alter table public.professionals
  add constraint professionals_profile_tenant_fk
  foreign key (tenant_id, profile_id) references public.profiles (tenant_id, id)
  on delete set null;
```

### Trigger guard (função)

```sql
create or replace function public.profiles_guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.tenant_id is distinct from old.tenant_id
       or new.must_change_password is distinct from old.must_change_password
       or new.email is distinct from old.email
       or new.active is distinct from old.active
       or new.deactivated_at is distinct from old.deactivated_at
       or new.deactivated_by is distinct from old.deactivated_by
       or new.role_changed_at is distinct from old.role_changed_at
       or new.role_changed_by is distinct from old.role_changed_by then
      raise exception 'privileged_column_change_denied' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
```

### Trigger handle_new_user (ajuste)

Popula `email` a partir de `auth.users.email` no insert de profile (signup e convite). Backfill idempotente para profiles existentes.

### RLS

Sem novas policies: `profiles_update_self_or_admin` já cobre admin do tenant; `profiles_super_admin` (SELECT) mantém leitura cross-tenant para super_admin. Escrita de colunas privilegiadas apenas via service role (Edge Functions). Nenhuma policy permite INSERT/DELETE de profiles ao cliente (já padrão).

### Invariantes no banco

- `active` default `true`; backfill `active=true` para existentes.
- Não permitir desativar o último admin ativo do tenant: validado em Edge Function (ADR-002) com `SELECT ... FOR UPDATE`/advisory lock; trigger de banco opcional (pode ser adicionado em ADR-002). ADR-001 não implementa essa regra (é lógica de negócio, não schema).
- `email` é read-only para o cliente (guard + grant).

## Alternativas consideradas

- **E-mail via Edge Function service role (B)**: descartado — quebra leitura direta sob RLS, expõe service role indiretamente, latência alta. (RESEARCH D1)
- **E-mail só no JWT (C)**: descartado — não resolve listagem de outros membros.
- **RLS WITH CHECK (B para D6)**: descartado — WITH CHECK enxerga só NEW, não OLD; não detecta mudança de coluna (já decidido no projeto, brain `profiles-privilegios-colunas`).
- **Edge Function sem guard no banco (C para D6)**: descartado — sem defesa em profundidade; trigger é a "prova da regra".
- **Hard delete de usuário**: descartado (anti-padrão, perde histórico; soft delete via `active`).

## Consequências

- Migration aditiva, sem drop de coluna existente (RNF-09).
- Backfill obrigatório antes de ativar leitura de `email` no frontend (ADR-004).
- `profiles` ganha coluna `email` duplicada de `auth.users` — risco de drift mitigado por trigger + backfill + teste de consistência (CA a definir na TASKS).
- FK composta exige unique `(tenant_id, id)` em profiles; constraint adicionada.
- `professionals.profile_id` FK agora é composta — migration recria constraint (sem perda de dados, `on delete set null`).
- Grant de coluna deve ser atualizado na mesma migration para as novas colunas.

## Fora desta decisão

- Lógica de desativação/reativação, revogação de sessão, bloqueio de último admin → ADR-002.
- Claim `active` no JWT → ADR-003.
- UI de gestão de usuários → ADR-004.
- Vínculo profissional↔login no convite → ADR-005.