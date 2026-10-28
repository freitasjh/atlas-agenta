-- Migration: clinical_records — imutabilidade por grants e triggers (ADR-07)
--
-- Continua a ADR-05 (schema) e a ADR-06 (policies). Registro clínico é append-only (RF-05, AC-06):
-- nenhum papel altera ou apaga, inclusive service_role. Três camadas independentes:
--   1. grants: update, delete e truncate revogados de anon, authenticated e service_role.
--      O owner da tabela (migrations, suporte) não é afetado por grant, por isso a camada 2 existe.
--   2. trigger de linha `clinical_records_block_update_delete` (before update or delete).
--   3. trigger de statement `clinical_records_block_truncate` (before truncate). TRUNCATE não passa
--      pela RLS, então precisa de trigger próprio.
--
-- Resultado por papel:
--   - authenticated e anon: falham no grant (42501, insufficient_privilege).
--   - owner: falha no trigger (23001, restrict_violation). Os triggers barram DML (UPDATE, DELETE,
--     TRUNCATE) de qualquer papel.
--   - service_role: sem grant, falha antes com 42501. O trigger continua barrando (23001) se o
--     grant voltar. O teste 30 prova essa camada re-concedendo o privilégio dentro da transação.
--
-- Limite conhecido: DDL do owner não é barrado pelos triggers. `alter table ... disable trigger` ou
-- `drop trigger` desativam as camadas 2 e 3. Risco aceito na ADR-07 (Consequências), mitigado por
-- migrations revisadas e log de DDL do Supabase.
--
-- Ordem de disparo: triggers BEFORE do mesmo evento disparam em ordem alfabética pelo nome.
-- `clinical_records_block_update_delete` vem antes de `clinical_records_validate` (ADR-05), então um
-- UPDATE é recusado pela imutabilidade antes de qualquer validação de conteúdo.
--
-- Mensagem fixa: a exceção não inclui valor de coluna, linha, DETAIL ou HINT (mesma regra da ADR-05).
-- A UI mapeia 23001 para texto pt-BR genérico (ADR-12).
--
-- Correção continua sendo INSERT (ADR-05/06). Esta migration não muda o caminho permitido.
--
-- Pré-requisito de produção: aplicar esta migration antes de qualquer uso de service_role sobre
-- clinical_records (ver ADR-07 e ADR-05, Consequências).
--
-- Idempotência: `revoke` é idempotente; `create or replace function`; triggers recriados com
-- `drop trigger if exists` antes de `create trigger`. Nenhum segredo no SQL.

-- ============================================================================
-- Camada 1: grants. Owner mantém acesso; os três papéis de cliente e service_role perdem o privilégio.
-- ============================================================================
revoke update, delete, truncate on table clinical_records from anon, authenticated, service_role;

-- ============================================================================
-- Camada 2 e 3: função de bloqueio. Não lê a linha nem o statement, então não ecoa dado clínico.
-- Usada tanto por linha (UPDATE/DELETE) quanto por statement (TRUNCATE).
-- ============================================================================
create or replace function clinical_records_block_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'clinical record is append-only: update, delete and truncate are not allowed'
    using errcode = 'restrict_violation', constraint = 'clinical_records_append_only';
  return null;
end;
$$;

drop trigger if exists clinical_records_block_update_delete on clinical_records;
create trigger clinical_records_block_update_delete
  before update or delete on clinical_records
  for each row execute function clinical_records_block_mutation();

drop trigger if exists clinical_records_block_truncate on clinical_records;
create trigger clinical_records_block_truncate
  before truncate on clinical_records
  for each statement execute function clinical_records_block_mutation();
