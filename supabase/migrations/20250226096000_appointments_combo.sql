-- Migration: appointments.combo_id em XOR com service_id — ADR-03 Fase 1b / SALÃO
-- Fecha o contrato de dados dos pacotes (combos): um agendamento passa a aceitar OU um serviço
-- avulso (service_id) OU um pacote (combo_id), nunca ambos nem nenhum (prd.md decisão (a),
-- Opção A, RF-S7/AC-6). O agendamento continua UMA LINHA, UMA JANELA [starts_at, ends_at):
-- preservam-se intactos a prevenção de conflito btree_gist (20250219092000), a máquina de estados
-- e o carimbo de confirmed_at (20250219093000 / 20250226092000), o snapshot price_cents e o
-- gancho de `concluido` que apura comissão lendo appointments.price_cents como base_cents
-- (20250226092000). Opção B (expandir em appointment_services) foi descartada no PRD.
--
-- Esta ADR NÃO recria o trigger appointments_validate_transition() nem toca as policies de
-- appointments: na Opção A o trigger não precisa mudar, e combo_id herda as policies existentes
-- (appointments_write_staff / appointments_write_own_professional / appointments_select_tenant de
-- 20250219091000). O operador que já grava o agendamento grava combo_id; o WITH CHECK por tenant
-- + a FK composta barram cross-tenant. Nenhuma cláusula de segment: o gating por salão é só de UI.
--
-- service_id hoje é NOT NULL (20250219091000); o XOR exige service_id NULLABLE. Todas as linhas
-- existentes têm service_id, então a mudança é aditiva na prática — não regride serviço avulso, e
-- a FK composta appointments_service_fk aceita null (MATCH SIMPLE: coluna null não é checada).
--
-- Idempotente no re-apply: add column/index if not exists, alter column drop not null (no-op no
-- 2º apply), e as constraints vão em bloco `do $$ ... pg_constraint ...` (padrão de
-- appointments_no_overlap). `supabase db reset` duas vezes deve terminar com exit 0 sem duplicar
-- objetos (RF-S14/AC-13). Nenhum segredo no SQL. Última migration aplicada: 20250226095000 ->
-- próximo livre 20250226096000.

-- ============================================================================
-- 1. Coluna combo_id opcional (alternativa, em XOR, ao service_id).
-- ============================================================================
alter table appointments add column if not exists combo_id uuid;

-- ============================================================================
-- 2. service_id passa a ser nullable (XOR exige um dos dois). Re-apply é no-op; a FK composta
--    appointments_service_fk continua válida com null (MATCH SIMPLE).
-- ============================================================================
alter table appointments alter column service_id drop not null;

-- ============================================================================
-- 3. FK composta por tenant + CHECK de XOR, de forma idempotente (padrão pg_constraint).
-- ============================================================================
do $$
begin
  -- FK COMPOSTA (tenant_id, combo_id) -> combos (tenant_id, id): um agendamento só liga a um
  -- pacote do MESMO tenant (coerência no schema, não só na UI; RF-S9/AC-3). on delete restrict
  -- protege o histórico — a app inativa o combo (active=false), nunca DELETE físico.
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_combo_fk'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table appointments
      add constraint appointments_combo_fk
      foreign key (tenant_id, combo_id)
      references combos (tenant_id, id) on delete restrict;
  end if;

  -- XOR: exatamente um de service_id / combo_id preenchido. Violação levanta SQLSTATE 23514
  -- (check_violation), que a app mapeia para mensagem pt-BR.
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_service_xor_combo'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table appointments
      add constraint appointments_service_xor_combo
      check (
        (service_id is not null and combo_id is null)
        or (service_id is null and combo_id is not null)
      );
  end if;
end
$$;

-- ============================================================================
-- 4. Índice parcial por tenant + combo (suporte a consultas por pacote; só linhas com combo).
-- ============================================================================
create index if not exists appointments_tenant_combo_idx
  on appointments (tenant_id, combo_id) where combo_id is not null;
