-- Migration: tabela combos (pacotes de serviços do salão) — ADR-01 Fase 1b / SALÃO
-- Primeiro recurso de domínio profundo do ramo salão: pacotes/combos — um agrupamento de
-- serviços vendido por um PREÇO PRÓPRIO FECHADO (prd.md §1, RF-S1). Esta migration cria só a
-- tabela-raiz `combos`: o lugar onde o nome e o `price_cents` do pacote moram, por tenant. É a
-- primeira unidade de trabalho da fatia — o dado antes da tela que o consome e antes do N:N
-- (combo_services, ADR-02) e do vínculo em appointments (ADR-03).
--
-- Template direto no repo: `services` em 20250217090000_operational_catalog.sql (mesma classe de
-- dado operacional: SELECT aberto ao tenant, escrita só admin) e `professional_commissions` em
-- 20250226090000_professional_commissions.sql (padrão de `default current_tenant_id()` recente).
--
-- Fronteiras (prd.md §4 / §9):
--   * Isolamento por tenant_id vindo SEMPRE de current_tenant_id() (JWT/profiles), NUNCA do
--     cliente. `tenant_id not null default current_tenant_id()` faz o INSERT do cliente — que não
--     envia tenant_id — passar no WITH CHECK. Índice por tenant + RLS habilitado.
--   * segment NÃO entra em NENHUMA cláusula de RLS. O pacote existe independentemente do ramo;
--     a trava é tenant_id. O gating por salão é só de UI (frontend). Travar RLS por segment
--     transformaria dado de produto em fronteira de segurança (anti-padrão) e negaria acesso a
--     tenant legado (segment=null).
--   * RBAC: preço de pacote é DADO OPERACIONAL (igual services.price_cents), não `charge`. SELECT
--     aberto a todo o tenant (admin/professional/receptionist); escrita só admin.
--   * `unique (tenant_id, id)` é o alvo referenciável das FKs COMPOSTAS de ADR-02 e ADR-03.
--   * Dinheiro em centavos inteiros (price_cents int, CHECK >= 0); nunca float (RF-S13).
--   * Sem `duration_minutes` (D-3: duração é a soma dos serviços, derivada no ato; coluna aditiva
--     fica para evolução futura). Sem nenhuma cláusula de segment.
--
-- Idempotente no re-apply: create table/index if not exists / drop policy if exists antes de cada
-- create policy. `supabase db reset` deve terminar com exit 0 e não duplicar objetos ao rodar
-- duas vezes seguidas (RF-S14/AC-13). Nenhum segredo no SQL. Role de app (authenticated) sem
-- BYPASSRLS (herdado). Última migration aplicada: 20250226093000 -> próximo livre 20250226094000.

-- ============================================================================
-- combos — pacote nomeado com preço próprio fechado, por tenant.
-- ============================================================================
create table if not exists combos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default current_tenant_id()
                references tenants (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  price_cents int not null check (price_cents >= 0),       -- preço fechado, centavos inteiros (D-2, RF-S13)
  active      bool not null default true,                  -- soft-delete por inativação; sem DELETE físico na app
  created_at  timestamptz not null default now(),
  -- alvo das FKs compostas de ADR-02 (combo_services) e ADR-03 (appointments.combo_id).
  constraint combos_tenant_id_unique unique (tenant_id, id)
);

-- Particionamento lógico multi-tenant.
create index if not exists combos_tenant_id_idx on combos (tenant_id);

alter table combos enable row level security;

-- SELECT: qualquer papel do tenant lê (preço de pacote é dado operacional, não `charge`).
drop policy if exists combos_select_same_tenant on combos;
create policy combos_select_same_tenant on combos for select
  using (tenant_id = current_tenant_id());

-- Escrita de catálogo: só admin do tenant. WITH CHECK espelha o USING para barrar gravar
-- linha de outro tenant.
drop policy if exists combos_write_admin on combos;
create policy combos_write_admin on combos for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');
