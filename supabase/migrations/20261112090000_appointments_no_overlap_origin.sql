-- ============================================================================
-- appointments_no_overlap — escopo por ORIGEM: a constraint protege
-- AGENDAMENTO, não registro de venda de balcão (bugfix pdv-venda-consecutiva).
--
-- Causa do defeito: a constraint nasceu na ADR-03 (migration 20250219092000)
-- antes de `origin` existir (20261111000000_walk_in_appointments.sql). Ela
-- indexava toda linha em status ativo, então uma venda walk-in CONCLUÍDA
-- continuava ocupando [starts_at, ends_at) e a venda seguinte para o mesmo
-- profissional violava a exclusão (SQLSTATE 23P01 -> 500 INTERNAL).
--
-- Decisão: `origin = 'agendado'` entra no predicado parcial. Venda de balcão
-- é registro de venda (nasce `em_atendimento` e conclui no pagamento), não
-- reserva de agenda; só o agendamento disputa o horário do profissional.
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
      -- Só agendamento ocupa a agenda; venda walk-in é registro de venda.
      where (origin = 'agendado' and status not in ('cancelado','nao_compareceu'));
  end if;
end
$$;
