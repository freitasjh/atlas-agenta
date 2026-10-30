-- Migration: subscription_status_changes + RPC admin_set_subscription_status (ADR-01, Fatia Super Admin)
-- Transforma a mudança de `subscription_status` de um UPDATE cru e sem trilha numa operação
-- REGISTRADA e ATÔMICA (RF-04d, RNF-06, R-08, CA-08). Dois requisitos de dados antecedem
-- qualquer tela ou Edge Function da fatia:
--
--   1. DESTINO PERSISTENTE DA TRILHA: uma linha por mudança (qual tenant, quem operou, de→para,
--      motivo curto opcional, quando). Dado sensível e cross-tenant — segue o padrão de
--      `webhook_events` (20250223090000): escrita só service role, leitura só super_admin.
--   2. ATOMICIDADE status+trilha: persistir o novo status e gravar a auditoria devem ser
--      atômicos (R-08, CA-08). Dois statements soltos na Edge Function não garantem isso; a RPC
--      `security definer` transacional garante — UPDATE e INSERT no mesmo corpo da função são
--      uma única transação implícita.
--
-- ISOLAMENTO MULTI-TENANT (RNF03, inegociável): `tenant_id not null references tenants` com RLS
-- habilitado. Como em `webhook_events`, NÃO há `default current_tenant_id()`: a linha é escrita
-- SÓ pelo service role (via RPC, chamada pela Edge Function ADR-03), que resolve o ator pelo JWT
-- no servidor, NUNCA do corpo da requisição. super_admin opera cross-tenant só por esse caminho
-- auditado; nenhum caminho de escrita pelo cliente comum.
--
-- RBAC: SELECT só super_admin (trilha de operação privilegiada da plataforma). NENHUMA policy de
-- INSERT/UPDATE/DELETE — qualquer escrita pelo cliente (role authenticated) é negada por RLS; a
-- gravação é exclusiva do service role, que bypassa RLS.
--
-- A validação da transição (§3.5) é feita na Edge Function (ADR-03), fonte única pt-BR, antes de
-- chamar a RPC. A RPC não repete o CHECK — foca em atomicidade e lock contra corrida.
--
-- Convenções: inglês/snake_case/plural; `created_at`/timestamps em timestamptz (UTC); nenhum
-- dinheiro aqui (sem *_cents). Os literais de status espelham SUBSCRIPTION_STATUSES em
-- src/types/domain.ts e o CHECK de `tenants` (20250216090000) — não divergir. Helpers
-- `current_role_name()` (security definer, 20250216091000) reutilizados, não recriados. Nenhum
-- segredo no SQL. Idempotente no re-apply (create table/index if not exists, drop policy if
-- exists, create or replace function).

-- ============================================================================
-- 1. subscription_status_changes — trilha de auditoria da mudança de status.
--    Uma linha por mudança. Escrita só service role (via RPC); leitura só super_admin.
-- ============================================================================
create table if not exists public.subscription_status_changes (
  id          uuid primary key default gen_random_uuid(),
  -- empresa cuja assinatura mudou; a trilha acompanha a vida da linha do tenant.
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  -- ator da mudança; resolvido no servidor pelo JWT, NUNCA do corpo. set null preserva a
  -- trilha se o profile do operador sair.
  changed_by  uuid references public.profiles (id) on delete set null,
  old_status  text not null
              check (old_status in ('trial','ativo','pendente','bloqueado','cancelado')),
  new_status  text not null
              check (new_status in ('trial','ativo','pendente','bloqueado','cancelado')),
  -- motivo curto, não-PII; limitado para não virar campo livre longo.
  reason      text check (reason is null or char_length(reason) <= 280),
  created_at  timestamptz not null default now()
);

create index if not exists subscription_status_changes_tenant_idx
  on public.subscription_status_changes (tenant_id, created_at desc);

alter table public.subscription_status_changes enable row level security;

-- SELECT: só super_admin (trilha sensível de operação privilegiada da plataforma).
drop policy if exists subscription_status_changes_super_admin
  on public.subscription_status_changes;
create policy subscription_status_changes_super_admin
  on public.subscription_status_changes for select
  using (current_role_name() = 'super_admin');

-- WRITE pelo cliente: NENHUMA policy de INSERT/UPDATE/DELETE. A gravação é exclusiva do service
-- role (via RPC abaixo, bypassa RLS). Sem policy de write, qualquer INSERT/UPDATE pelo cliente
-- (role authenticated) é negado por RLS.

-- ============================================================================
-- 2. admin_set_subscription_status — muda o status e grava a trilha ATOMICAMENTE.
--    security definer: escreve tenants + subscription_status_changes, vedada ao cliente.
--    O ator (p_changed_by) é resolvido no servidor pela Edge Function; a RPC não lê o JWT.
-- ============================================================================
create or replace function public.admin_set_subscription_status(
  p_tenant_id  uuid,
  p_new_status text,
  p_changed_by uuid,
  p_reason     text default null
)
returns table (old_status text, new_status text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old text;
begin
  -- Trava a linha do tenant contra corrida de duas mudanças simultâneas (FOR UPDATE).
  select t.subscription_status into v_old
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if v_old is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;

  update public.tenants
  set subscription_status = p_new_status
  where id = p_tenant_id;

  insert into public.subscription_status_changes
    (tenant_id, changed_by, old_status, new_status, reason)
  values
    (p_tenant_id, p_changed_by, v_old, p_new_status, p_reason);

  -- UPDATE + INSERT no mesmo corpo = uma transação implícita → atômicos (R-08).
  return query select v_old, p_new_status;
end;
$$;

comment on function public.admin_set_subscription_status(uuid, text, uuid, text) is
  'Muda tenants.subscription_status e grava a trilha em subscription_status_changes atomicamente '
  '(ADR-01 Super Admin, R-08). Trava a linha do tenant (FOR UPDATE) contra corrida; levanta '
  'tenant_not_found se o tenant nao existe. O ator (p_changed_by) e resolvido no servidor pela '
  'Edge Function admin-subscription, nunca do corpo. Validacao da transicao fica na Edge Function. '
  'Nenhum segredo no SQL.';

-- Função privilegiada: só o service role (Edge Function admin-subscription) invoca.
revoke all on function public.admin_set_subscription_status(uuid, text, uuid, text) from public;
revoke all on function public.admin_set_subscription_status(uuid, text, uuid, text) from authenticated;
revoke all on function public.admin_set_subscription_status(uuid, text, uuid, text) from anon;
