-- Migration: identidade interna isolada `internal_operators` (internal-operators-mfa, BE-01).
-- Aditiva + idempotente (re-executável). deny-all: RLS habilitado SEM policies e SEM
-- grants para anon/authenticated — só service_role (dono) toca. Backfill de
-- `profiles.role=super_admin` com `where not exists` + freeze de novos super_admin
-- via trigger 42501. Audit append-only service_role-only.
--
-- Ordem: tabela -> revoke -> helper -> audit -> backfill + contagem -> freeze trigger.

-- 1. Tabela de operadores internos (PK -> auth.users, sem cascade para órfão nunca sumir sozinho).
create table if not exists public.internal_operators (
  user_id uuid primary key references auth.users (id),
  created_at timestamptz not null default now(),
  created_by uuid,
  disabled_at timestamptz
);

create index if not exists internal_operators_disabled_at_idx
  on public.internal_operators (disabled_at) where disabled_at is null;

-- 2. deny-all explícito: RLS ligado, nenhuma policy (select/insert/update/delete negados
--    para anon/authenticated por ausência de policy). Revokes defensivos.
alter table public.internal_operators enable row level security;

revoke all on public.internal_operators from anon, authenticated;

-- 3. Helper security definer: true só para operador ativo. search_path fixo anti-injeção.
--    Break-glass = F1: primeiros operadores nascem via backfill/migration auditada;
--    após o bootstrap, novos operadores SÓ via migration (trigger freeze acima).
create or replace function public.is_internal_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.internal_operators
    where user_id = auth.uid() and disabled_at is null
  );
$$;

revoke all on function public.is_internal_operator() from anon, authenticated;
revoke all on function public.is_internal_operator() from public;

-- 4. Auditoria append-only (só service_role escreve; sem update/delete).
create table if not exists public.internal_operator_audit (
  id bigint generated always as identity primary key,
  operator_user_id uuid,
  action text not null,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);

alter table public.internal_operator_audit enable row level security;

revoke all on public.internal_operator_audit from anon, authenticated;

-- 5. Backfill: todo super_admin atual vira operador (idempotente, nunca duplica).
insert into public.internal_operators (user_id)
select p.id from public.profiles p
where p.role = 'super_admin'
  and not exists (select 1 from public.internal_operators o where o.user_id = p.id);

-- 6. Freeze legado: nenhum INSERT/UPDATE pode criar ou promover para super_admin
--    quando já existir ao menos um operador interno. Recusado com 42501
--    (insufficient_privilege), inclusive para service_role — novos operadores
--    nascem SÓ via migration auditada (break-glass = F1).
--    Greenfield: com `internal_operators` vazia (primeiro bootstrap) o trigger
--    libera; o handler `bootstrap-super-admin` já barra quando há ≥1 operador.
create or replace function public.freeze_super_admin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'super_admin' then
    begin
      if not exists (select 1 from public.internal_operators limit 1) then
        return new;
      end if;
    exception when undefined_table then
      return new;
    end;
    raise exception 'super_admin role is frozen: use internal_operators migration'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.freeze_super_admin_role() from anon, authenticated;
revoke all on function public.freeze_super_admin_role() from public;

drop trigger if exists profiles_freeze_super_admin on public.profiles;

create trigger profiles_freeze_super_admin
  before insert or update of role on public.profiles
  for each row execute function public.freeze_super_admin_role();
