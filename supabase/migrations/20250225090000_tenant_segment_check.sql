-- Migration: check constraint em tenants.segment (enum fechado, nullable) — ADR-01 Fase 1a (ramo)
-- A coluna tenants.segment já existe como TEXT livre, sem check e sem uso (ver
-- 20250216090000_tenants.sql). A Fase 1a torna o ramo um enum fechado de três valores
-- — barbearia, clinica, salao — com paridade literal TS↔SQL (os mesmos literais vivem em
-- BUSINESS_SEGMENTS, src/types/domain.ts — ADR-03).
--
-- Decisões do gate já travadas (prd.md §7.2):
--   D1 — enum fechado de 3 valores, SEM 'outro'.
--   D2 — legados permanecem NULL (fallback genérico), SEM backfill de default arbitrário.
--
-- Esta é a PRIMEIRA migration da fatia porque o trigger da ADR-02 passa a GRAVAR segment, e
-- convém que o check já exista quando isso acontecer (regra dura de ordenação — prd.md §6,
-- analysis-data.md §9). A última migration aplicada é 20250224090000_dashboard_agenda_rpcs.sql,
-- então o próximo timestamp livre é 20250225090000.
--
-- Fronteiras (prd.md §4 / analysis-data.md §6):
--   * RLS inalterada — não há tabela nova; tenants já tem RLS; a coluna herda as policies
--     existentes. segment NÃO é fronteira de segurança, é dado de produto/UX.
--   * Sem índice em segment (baixa cardinalidade, não é chave de filtro multi-tenant; o
--     isolamento continua por tenant_id).
--   * Migration nova, nunca editar migration aplicada. Idempotente (drop … if exists + add):
--     supabase db reset termina com exit 0 e não duplica constraints.
--   * Nenhum segredo no SQL; sem dinheiro novo; sem tempo novo.

-- 1. Defesa: normaliza para NULL qualquer valor pré-existente fora do enum (caso algum dado
--    tenha sido inserido manualmente enquanto a coluna era TEXT livre). Preserva legados como
--    ramo genérico (D2) e garante que o ADD CONSTRAINT a seguir não falhe por dado sujo.
update tenants
set segment = null
where segment is not null
  and segment not in ('barbearia', 'clinica', 'salao');

-- 2. Adiciona a constraint de forma idempotente. A coluna PERMANECE TEXT e nullable (D2):
--    nenhuma alteração de tipo nem NOT NULL. Literais idênticos a BUSINESS_SEGMENTS (ADR-03).
alter table tenants drop constraint if exists tenants_segment_check;

alter table tenants
  add constraint tenants_segment_check
  check (segment is null or segment in ('barbearia', 'clinica', 'salao'));
