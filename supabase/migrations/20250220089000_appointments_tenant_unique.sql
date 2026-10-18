-- Migration: appointments_tenant_unique — expõe unique (tenant_id, id) em appointments (ADR-01 WhatsApp)
-- A tabela `messages` (ADR-03 desta fase) precisa de uma FK COMPOSTA
-- `(tenant_id, appointment_id) -> appointments (tenant_id, id)` para garantir, no schema, que
-- uma mensagem só referencie um agendamento do MESMO tenant (coerência de tenant no banco, não
-- só na UI — padrão travado nas fases anteriores). Ao contrário de `customers`, `services` e
-- `professionals`, que já expõem `unique (tenant_id, id)`, `appointments` (migration
-- 20250219091000) só tem `id uuid primary key` e nunca foi alvo de FK. Sem um par único
-- (tenant_id, id) a FK composta de `messages` FALHA no `supabase db reset` por falta de alvo.
--
-- A migration aplicada 20250219091000_appointments.sql NÃO pode ser editada (regra de
-- versionamento: nova migration nunca edita aplicada). A correção é esta migration nova, que só
-- adiciona a constraint. Timestamp 20250220089000 é posterior à última existente
-- (20250219093000) e ANTERIOR às migrations de whatsapp_instances/messages desta fase — garante
-- que o alvo único exista antes da FK composta.
--
-- Decisão herdada da análise de dados (§4.2): Opção A — adicionar `unique (tenant_id, id)`.
-- Opção B (FK simples appointment_id -> appointments(id) sem o par de tenant) foi DESCARTADA por
-- reabrir o buraco cross-tenant que as FKs compostas existem para fechar.
--
-- Não altera RLS, índices de domínio nem colunas de `appointments`. A constraint única cria seu
-- índice de suporte automaticamente. Não toca o trigger da máquina de estados (20250219093000).
-- Nenhum segredo no SQL.
--
-- Idempotência: `add constraint` não aceita `if not exists` para unique constraints, então a
-- criação vai num bloco `do $$` que verifica `pg_constraint` antes de criar — mantém o
-- `db reset` re-executável sem erro (mesmo padrão de 20250219092000_appointments_no_overlap).

-- alvo da FK composta de messages (ADR-03): coerência de tenant no banco.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_tenant_id_unique'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table appointments
      add constraint appointments_tenant_id_unique unique (tenant_id, id);
  end if;
end
$$;
