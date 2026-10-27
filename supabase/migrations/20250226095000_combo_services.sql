-- Migration: tabela combo_services (N:N combo↔services) — ADR-02 Fase 1b / SALÃO
-- Um pacote é composto por ≥1 serviço do PRÓPRIO tenant (prd.md RF-S1/RF-S2). Esta migration cria
-- a tabela de vínculo N:N `combo_services` que fecha a coerência de tenant NO SCHEMA, não só na
-- UI — o defeito-alvo explícito do usuário: "combo de serviços do tenant A referenciado por
-- tenant B deve ser impossível por construção" (prd.md §4). Depende de ADR-01 (`combos` + alvo
-- `combos_tenant_id_unique`) e de `services` (20250217090000), ambos já aplicados.
--
-- Template direto no repo: `service_professionals` em 20250217090000_operational_catalog.sql —
-- FK COMPOSTA por tenant dos dois lados, par único por tenant, RLS operacional (SELECT aberto ao
-- tenant, escrita só admin). Este N:N é um espelho estrutural dele.
--
-- Fronteiras (prd.md §4 / §9):
--   * FK COMPOSTA por tenant dos DOIS lados: (tenant_id, combo_id) → combos e
--     (tenant_id, service_id) → services. Vincular ao combo do tenant A um service_id do tenant B
--     (mesmo id forjado no payload) falha na FK composta (erro 23503), cross-tenant impossível
--     por construção (RF-S2/AC-2).
--   * Isolamento por tenant_id vindo SEMPRE de current_tenant_id() (JWT/profiles), NUNCA do
--     cliente. `tenant_id not null default current_tenant_id()` faz o INSERT do cliente passar no
--     WITH CHECK sem enviar tenant_id. Índice por tenant + RLS habilitado.
--   * segment NÃO entra em NENHUMA cláusula de RLS. A trava é tenant_id; gating por salão é só de
--     UI. (prd.md §4)
--   * RBAC: SELECT aberto a todo o tenant (vínculo de catálogo é dado operacional); escrita só
--     admin (prd.md §5), espelhando service_professionals.
--   * Par único (tenant_id, combo_id, service_id): sem serviço duplicado no mesmo combo.
--
-- Invariante registrada (prd.md §7.3): "combo tem ≥1 serviço" é regra de APP, não de schema — um
-- N:N não exige "pelo menos um filho" no INSERT do pai (o combo nasce antes do primeiro vínculo).
-- Dono da regra: a camada de app (zod ≥1 em ADR-04; escrita transacional). Nenhuma constraint/
-- trigger de cardinalidade mínima aqui. Mesmo tratamento de service_professionals.
--
-- Ações de FK:
--   * combo_services_combo_fk ON DELETE CASCADE: inativar/limpar um combo leva os vínculos junto.
--   * combo_services_service_fk ON DELETE RESTRICT: não apagar fisicamente um serviço que compõe
--     um combo (a app usa soft-delete active=false) — coerente com appointments_service_fk.
--
-- Idempotente no re-apply: create table/index if not exists / drop policy if exists antes de cada
-- create policy. Constraints (FK/unique) que não aceitam `if not exists` vão diretas no
-- create table if not exists (idempotência garantida pela criação condicional da tabela), mesmo
-- padrão de service_professionals. `supabase db reset` deve terminar com exit 0 rodando duas
-- vezes seguidas (RF-S14/AC-13). Nenhum segredo no SQL. Última migration aplicada: 20250226094000
-- -> próximo livre 20250226095000.

-- ============================================================================
-- combo_services (N:N) — quais serviços compõem cada combo.
-- FKs COMPOSTAS por tenant: combo_id e service_id têm de ser do MESMO tenant da linha de vínculo.
-- Fecha o buraco cross-tenant no schema, não só na UI.
-- ============================================================================
create table if not exists combo_services (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default current_tenant_id()
               references tenants (id) on delete cascade,
  combo_id   uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  -- inativar/limpar um combo leva os vínculos junto.
  constraint combo_services_combo_fk
    foreign key (tenant_id, combo_id)
    references combos (tenant_id, id) on delete cascade,
  -- não apaga fisicamente um serviço que compõe um combo (app usa soft-delete active=false).
  constraint combo_services_service_fk
    foreign key (tenant_id, service_id)
    references services (tenant_id, id) on delete restrict,
  -- par único por tenant (sem serviço duplicado no mesmo combo).
  constraint combo_services_unique unique (tenant_id, combo_id, service_id)
);

-- Particionamento lógico multi-tenant.
create index if not exists combo_services_tenant_id_idx
  on combo_services (tenant_id);
-- navegação dos dois lados do N:N.
create index if not exists combo_services_tenant_combo_idx
  on combo_services (tenant_id, combo_id);
create index if not exists combo_services_tenant_service_idx
  on combo_services (tenant_id, service_id);

alter table combo_services enable row level security;

-- SELECT: qualquer papel do tenant lê (vínculo de catálogo é dado operacional, não `charge`).
drop policy if exists combo_services_select_same_tenant on combo_services;
create policy combo_services_select_same_tenant on combo_services for select
  using (tenant_id = current_tenant_id());

-- Escrita de catálogo: só admin do tenant. WITH CHECK espelha o USING para barrar gravar
-- linha de outro tenant.
drop policy if exists combo_services_write_admin on combo_services;
create policy combo_services_write_admin on combo_services for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');
