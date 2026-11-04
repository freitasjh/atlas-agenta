-- Migration: appointments_customer_unique — expõe unique (tenant_id, id, customer_id) em appointments (ADR-03)
-- A ficha do cliente (clinical_records, ADR-05) referencia o atendimento por FK COMPOSTA
-- `(tenant_id, appointment_id, customer_id) -> appointments (tenant_id, id, customer_id)`.
-- Isso garante, no schema, que o cliente da ficha é o cliente do atendimento, mesmo que a app erre.
-- Uma FK composta exige um alvo com unique exato; `appointments` tem apenas
-- `unique (tenant_id, id)` (migration 20250220089000). Como `id` já é único, esta constraint não
-- pode falhar com dado existente.
--
-- Migration aplicada não é editada: esta é uma migration nova, só aditiva.
-- Não altera colunas, índices existentes, trigger de estados, RLS ou policies.
-- Nenhum segredo no SQL.
--
-- Idempotência: `add constraint` não aceita `if not exists` para unique, então a criação vai num
-- bloco `do $$` que verifica `pg_constraint` antes (mesmo padrão de 20250220089000).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_tenant_id_customer_unique'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table appointments
      add constraint appointments_tenant_id_customer_unique unique (tenant_id, id, customer_id);
  end if;
end
$$;
