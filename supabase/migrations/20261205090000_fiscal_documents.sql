-- Migration: ADR-02 — schema fiscal (fiscal_documents + fiscal_events).
-- Aditiva e idempotente (create table/index if not exists, drop policy/trigger if
-- exists). Nenhuma migration já aplicada é editada.
--
-- Trilha auditável da NFCe (PRD RF-02/RF-03/RF-04/RF-40 + fronteiras §7):
--   fiscal_documents -> 1 linha por origem (tenant, origem_tipo, origem_id);
--                         snapshot de valor, nunca recalcula receita nem toca
--                         `appointment_payments` (emissão não gera recebimento).
--   fiscal_events    -> append-only do ciclo (emissão, contingência, rejeição,
--                         cancelamento, carta). Sem update/delete por trigger,
--                         inclusive para service_role; correção é linha nova.
--
-- Decisões:
-- - origem_id é uuid solto (sem FK): a origem é polimórfica
--   (appointment|sale) e a tabela de vendas nasce em ADR futura. A amarração ao
--   tenant vem do `tenant_id` + unique por origem (idempotência), não de FK.
-- - `chave_acesso` nullable até autorizar; unicidade global quando informada
--   (`where not null`) — a idempotência pré-autorização é o unique por origem.
-- - `xml` inline (text) nesta fase; `danfe_url` aponta para o arquivo. Bucket
--   privado de storage avaliado na ADR-03 junto com o emissor (nenhum bucket é
--   criado aqui para não antecipar escopo).
-- - Escrita: nenhuma policy/grant de escrita para authenticated/anon; só
--   service_role escreve (emissor futuro, ADR-03). Leitura direta só admin.
-- - `valor_cents` inteiro > 0; todo tempo timestamptz (UTC).
-- - Sem backfill: tabela nasce vazia (UI lista empty state até ADR-03).

-- ============================================================================
-- 1. fiscal_documents: 1 NFCe por origem.
-- ============================================================================
create table if not exists public.fiscal_documents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default current_tenant_id()
                     references public.tenants (id) on delete cascade,
  origem_tipo      text not null check (origem_tipo in ('appointment','sale')),
  origem_id        uuid not null,
  numero           text,
  serie            text,
  chave_acesso     text,
  status           text not null default 'pendente' check (status in (
                       'pendente','autorizada','contingencia','rejeitada','cancelada'
                     )),
  valor_cents      int not null check (valor_cents > 0),
  xml              text,
  danfe_url        text,
  created_at       timestamptz not null default now(),
  authorized_at    timestamptz,
  constraint fiscal_documents_tenant_id_unique unique (tenant_id, id),
  constraint fiscal_documents_autorizada_check check (
    status <> 'autorizada'
    or (chave_acesso is not null and xml is not null and authorized_at is not null)
  ),
  constraint fiscal_documents_cancelada_check check (
    status <> 'cancelada' or xml is not null
  )
);

-- Idempotência por origem: replay da mesma origem viola o unique (23505).
create unique index if not exists fiscal_documents_origem_uidx
  on public.fiscal_documents (tenant_id, origem_tipo, origem_id);

-- Chave nacionalmente única quando informada; nula (pré-autorização) não colide.
create unique index if not exists fiscal_documents_chave_uidx
  on public.fiscal_documents (chave_acesso)
  where chave_acesso is not null;

create index if not exists fiscal_documents_tenant_status_idx
  on public.fiscal_documents (tenant_id, status, created_at);

-- ============================================================================
-- 2. fiscal_events: trilha append-only do documento.
-- ============================================================================
create table if not exists public.fiscal_events (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default current_tenant_id()
                         references public.tenants (id) on delete cascade,
  fiscal_document_id   uuid not null,
  tipo                 text not null check (tipo in (
                           'emissao','contingencia','rejeicao','cancelamento','carta'
                         )),
  motivo               text,
  payload              jsonb not null default '{}'::jsonb,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  constraint fiscal_events_document_fk
    foreign key (tenant_id, fiscal_document_id)
    references public.fiscal_documents (tenant_id, id) on delete restrict,
  constraint fiscal_events_created_by_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id) on delete restrict
);

create index if not exists fiscal_events_tenant_document_idx
  on public.fiscal_events (tenant_id, fiscal_document_id, created_at);

-- Append-only: update/delete barrados por trigger para qualquer role,
-- inclusive service_role. Correção é linha nova, nunca mutação.
create or replace function public.fiscal_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'fiscal_events é append-only: update/delete proibidos (use linha nova)';
end;
$$;

drop trigger if exists fiscal_events_no_update_delete on public.fiscal_events;
create trigger fiscal_events_no_update_delete
  before update or delete on public.fiscal_events
  for each row execute function public.fiscal_events_immutable();

-- ============================================================================
-- 3. RLS + grants: leitura direta só admin do tenant; escrita só service_role.
-- ============================================================================
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_events enable row level security;

drop policy if exists fiscal_documents_select_tenant_admin on public.fiscal_documents;
create policy fiscal_documents_select_tenant_admin on public.fiscal_documents
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

drop policy if exists fiscal_events_select_tenant_admin on public.fiscal_events;
create policy fiscal_events_select_tenant_admin on public.fiscal_events
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.fiscal_documents from anon, authenticated;
grant select on table public.fiscal_documents to authenticated;
grant all on table public.fiscal_documents to service_role;

revoke all on table public.fiscal_events from anon, authenticated;
grant select on table public.fiscal_events to authenticated;
grant all on table public.fiscal_events to service_role;
