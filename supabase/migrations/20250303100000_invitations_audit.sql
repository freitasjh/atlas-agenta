-- Migration: invitations + audit_log (ADR-17)
-- Convites de membros por e-mail (super admin e admin de tenant) e trilha de auditoria
-- das ações privilegiadas. Escrita exclusiva do service role (Edge Functions); leitura
-- restrita por RLS conforme o papel do usuário autenticado.

-- ============================================================================
-- 1. invitations
-- ============================================================================
create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants (id) on delete cascade,
  email            text not null,
  role             text not null
                   check (role in ('super_admin','admin','professional','receptionist')),
  token_hash       text not null,
  status           text not null default 'pending'
                   check (status in ('pending','accepted','revoked','expired')),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create unique index if not exists invitations_token_hash_uidx
  on public.invitations (token_hash);

create index if not exists invitations_tenant_id_idx
  on public.invitations (tenant_id);

create index if not exists invitations_created_at_idx
  on public.invitations (created_at);

create index if not exists invitations_status_idx
  on public.invitations (status);

create index if not exists invitations_tenant_created_idx
  on public.invitations (tenant_id, created_at desc);

alter table public.invitations enable row level security;

drop policy if exists invitations_select_super_admin on public.invitations;
create policy invitations_select_super_admin on public.invitations for select
  using (current_role_name() = 'super_admin' and tenant_id is null);

drop policy if exists invitations_select_tenant_admin on public.invitations;
create policy invitations_select_tenant_admin on public.invitations for select
  using (current_role_name() = 'admin' and tenant_id = current_tenant_id());

-- Escrita: NENHUMA policy para authenticated; service role bypassa RLS.

-- ============================================================================
-- 2. audit_log
-- ============================================================================
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants (id) on delete set null,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_tenant_id_idx
  on public.audit_log (tenant_id);

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at);

create index if not exists audit_log_tenant_created_idx
  on public.audit_log (tenant_id, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_select_super_admin on public.audit_log;
create policy audit_log_select_super_admin on public.audit_log for select
  using (current_role_name() = 'super_admin' and tenant_id is null);

drop policy if exists audit_log_select_tenant_admin on public.audit_log;
create policy audit_log_select_tenant_admin on public.audit_log for select
  using (current_role_name() = 'admin' and tenant_id = current_tenant_id());

-- Escrita: NENHUMA policy para authenticated; service role bypassa RLS.
