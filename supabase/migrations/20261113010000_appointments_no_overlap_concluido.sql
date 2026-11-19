-- ============================================================================
-- G3 (Fase 0, roadmap-oficial-v1.md §5) — atendimento concluído não ocupa slot.
--
-- Causa raiz: a constraint `appointments_no_overlap` (20261112090000) liberava `cancelado`,
-- `nao_compareceu` e apenas `walk_in` concluído. Um AGENDADO concluído antes do fim do
-- intervalo continuava indexado, então um encaixe/walk-in sobre a janela violava a exclusão
-- (SQLSTATE 23P01 -> 409 SLOT_CONFLICT/500), impedindo o profissional de vender no horário.
--
-- Solução: `concluido` é status final/histórico (invariante de slot do roadmap §9.2: "status
-- final libera") -> sai do índice de conflito para TODA origem, não só walk-in.
--
-- Preservado sem alteração semântica:
--   * btree_gist (uuid `=` + range `&&` no mesmo índice GiST);
--   * `tenant_id with =` (isolamento multi-tenant na barreira de conflito);
--   * `professional_id with =` (conflito é por profissional);
--   * `tstzrange(starts_at, ends_at)` default `[)` (encostar não colide);
--   * `status not in (...)` libera o horário — agora incluindo `concluido`.
--   * walk-in `em_atendimento` (venda aberta) e agendados ativos continuam indexados.
--
-- Idempotente e aditiva: `drop constraint if exists` + bloco `pg_constraint` (mesmo padrão da
-- migration original). `db reset` re-executável. Não toca RLS, trigger, policy, ledger, charges
-- nem comissão. Nenhum segredo no SQL.
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
      -- Status finais são histórico, não reserva: cancelado/não compareceu/concluído
      -- liberam o horário para qualquer origem. Andamento (pendente/confirmado/
      -- em_atendimento) continua ocupando o slot do profissional.
      where (
        status not in ('cancelado','nao_compareceu','concluido')
      );
  end if;
end
$$;
