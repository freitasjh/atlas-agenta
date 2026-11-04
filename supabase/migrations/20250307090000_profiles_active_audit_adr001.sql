-- Migration: ADR-001 — schema profiles.active/audit + invitations.professional_id + helper
-- Aditiva e idempotente. Nenhuma coluna/tabela existente é removida ou renomeada.
-- Convenções: snake_case, timestamptz UTC, *_cents (n/a aqui), RLS mantido.

-- ============================================================================
-- 1. profiles: colunas de ativação, auditoria de desativação/troca de papel e e-mail desnormalizado
-- ============================================================================
alter table public.profiles
  add column if not exists active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.profiles (id) on delete set null,
  add column if not exists role_changed_at timestamptz,
  add column if not exists role_changed_by uuid references public.profiles (id) on delete set null,
  add column if not exists email text;

-- Backfill de active para linhas pré-existentes (coluna nova já nasce true pelo default,
-- mas garante explicitamente).
update public.profiles set active = true where active is null;

-- Índice para filtro por tenant + active.
create index if not exists profiles_tenant_id_active_idx
  on public.profiles (tenant_id, active);

-- Chave única composta para ser alvo de FKs compostas por tenant.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_tenant_id_id_unique'
  ) then
    alter table public.profiles
      add constraint profiles_tenant_id_id_unique unique (tenant_id, id);
  end if;
end;
$$;

-- Backfill idempotente de e-mail a partir de auth.users.
update public.profiles p
   set email = u.email
  from auth.users u
 where p.id = u.id
   and p.email is null;

-- ============================================================================
-- 2. invitations: vínculo opcional com professional (mesmo tenant validado por FK composta)
-- ============================================================================
alter table public.invitations
  add column if not exists professional_id uuid;

alter table public.invitations
  drop constraint if exists invitations_professional_tenant_fk;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_professional_tenant_fk'
  ) then
    alter table public.invitations
      add constraint invitations_professional_tenant_fk
      foreign key (tenant_id, professional_id)
      references public.professionals (tenant_id, id)
      on delete set null (professional_id);
  end if;
end;
$$;

-- Índice para lookup por professional_id (ADR-001 interface congelada).
create index if not exists invitations_professional_id_idx
  on public.invitations (professional_id);

-- ============================================================================
-- 3. professionals: FK composta (tenant_id, profile_id) -> (tenant_id, id) em profiles
-- ============================================================================
alter table public.professionals
  drop constraint if exists professionals_profile_id_fkey;

alter table public.professionals
  drop constraint if exists professionals_profile_tenant_fk;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'professionals_profile_tenant_fk'
  ) then
    alter table public.professionals
      add constraint professionals_profile_tenant_fk
      foreign key (tenant_id, profile_id)
      references public.profiles (tenant_id, id)
      on delete set null (profile_id);
  end if;
end;
$$;

-- ============================================================================
-- 4. Guard de colunas privilegiadas em profiles (estendido para colunas do ADR-001)
-- ============================================================================
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.tenant_id is distinct from old.tenant_id
       or new.active is distinct from old.active
       or new.deactivated_at is distinct from old.deactivated_at
       or new.deactivated_by is distinct from old.deactivated_by
       or new.role_changed_at is distinct from old.role_changed_at
       or new.role_changed_by is distinct from old.role_changed_by
       or new.email is distinct from old.email then
      raise exception 'privileged_column_change_denied'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.profiles_guard_privileged_columns() is
  'Barra a escrita de profiles.id/role/tenant_id/active/deactivated_*/role_changed_*/email por '
  'sessao do cliente (auth.role() = authenticated). Restrito ao service role e funcoes security '
  'definer. Edicao de full_name segue permitida. ADR-001.';

drop trigger if exists profiles_guard_privileged_columns_trg on public.profiles;
create trigger profiles_guard_privileged_columns_trg
  before update on public.profiles
  for each row
  execute function public.profiles_guard_privileged_columns();

revoke execute on function public.profiles_guard_privileged_columns()
  from public, anon, authenticated;

-- ============================================================================
-- 5. Helper current_user_is_active() (security definer)
-- ============================================================================
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

comment on function public.current_user_is_active() is
  'Retorna true se o usuario autenticado existe e esta ativo. Security definer. ADR-001.';

revoke execute on function public.current_user_is_active() from public, anon;
grant execute on function public.current_user_is_active() to authenticated, service_role;

-- ============================================================================
-- 6. create_tenant_with_admin: desnormalizar email no profile (ADR-001)
-- ============================================================================
create or replace function public.create_tenant_with_admin(
  p_user_id uuid,
  p_owner_email text,
  p_trade_name text,
  p_full_name text,
  p_segment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  if p_segment is not null and p_segment not in ('barbearia', 'clinica', 'salao') then
    raise exception 'segment_invalid' using errcode = 'invalid_parameter_value';
  end if;
  insert into tenants (legal_name, trade_name, owner_email, plan, subscription_status, trial_ends_at, segment)
  values (
    p_trade_name,
    p_trade_name,
    p_owner_email,
    'individual',
    'trial',
    now() + interval '14 days',
    p_segment
  )
  returning id into v_tenant_id;
  insert into profiles (id, tenant_id, role, full_name, email, active)
  values (p_user_id, v_tenant_id, 'admin', p_full_name, p_owner_email, true);
  perform seed_message_templates(v_tenant_id, p_segment);
  return v_tenant_id;
end;
$$;

revoke all on function public.create_tenant_with_admin(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_tenant_with_admin(uuid, text, text, text, text)
  to service_role;
