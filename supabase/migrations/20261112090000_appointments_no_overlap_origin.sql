-- ============================================================================
-- appointments_no_overlap — predicado MÍNIMO: só a venda walk-in CONCLUÍDA
-- sai do índice; walk-in em andamento continua ocupando o horário.
-- (bugfix pdv-venda-consecutiva)
--
-- Causa do defeito: a constraint nasceu na ADR-03 (migration 20250219092000)
-- antes de `origin` existir (20261111000000_walk_in_appointments.sql). Ela
-- indexava toda linha em status ativo, então uma venda walk-in CONCLUÍDA
-- continuava ocupando [starts_at, ends_at) e a venda seguinte para o mesmo
-- profissional violava a exclusão (SQLSTATE 23P01 -> 500 INTERNAL).
--
-- Por que o predicado é MÍNIMO e não `origin = 'agendado'`:
--   * excluir TODO walk-in (inclusive `em_atendimento`) permitiria
--     (a) walk-in sobre um agendamento existente e (b) duas vendas abertas
--     simultâneas do mesmo profissional — double-booking real, violando RF06
--     de `.agents/rules/dominio.md` e divergindo de `useAvailableSlots.ts` /
--     `AppointmentFormDialog.tsx`, que tratam walk-in como horário ocupado;
--   * `walk_in` CONCLUÍDO é registro histórico de venda, não reserva de
--     agenda: sai do índice e resolve o bug reportado;
--   * `walk_in` EM ATENDIMENTO (`em_atendimento`) é venda aberta e disputa o
--     horário do profissional: permanece indexado, bloqueando venda
--     simultânea/sobreposição.
--
-- Preservado sem alteração semântica:
--   * btree_gist (uuid `=` + range `&&` no mesmo índice GiST);
--   * `tenant_id with =` (isolamento multi-tenant na barreira de conflito);
--   * `professional_id with =` (conflito é por profissional);
--   * `tstzrange(starts_at, ends_at)` default `[)` (encostar não colide);
--   * `status not in ('cancelado','nao_compareceu')` libera o horário.
--
-- Idempotente e aditiva: `drop constraint if exists` + bloco `pg_constraint`
-- (mesmo padrão da migration original). `db reset` re-executável. Não toca
-- RLS, trigger, policy, ledger, charges nem comissão. Nenhum segredo no SQL.
-- ============================================================================

create extension if not exists btree_gist;

alter table public.appointments
  drop constraint if exists appointments_no_overlap;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_no_overlap'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_no_overlap
      exclude using gist (
        tenant_id       with =,   -- isolamento: só colide dentro do mesmo tenant
        professional_id with =,   -- conflito é por profissional
        tstzrange(starts_at, ends_at) with &&  -- faixas que se sobrepõem ([) semiaberto)
      )
      -- Predicado mínimo: cancelado/não compareceu liberam o horário e a venda
      -- walk-in CONCLUÍDA é histórico (não reserva). Walk-in `em_atendimento`
      -- permanece indexado — venda aberta disputa o horário do profissional.
      where (
        status not in ('cancelado','nao_compareceu')
        and not (origin = 'walk_in' and status = 'concluido')
      );
  end if;
end
$$;
