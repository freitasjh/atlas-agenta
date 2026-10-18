-- Migration: appointments_no_overlap — prevenção de conflito por profissional (ADR-03, RF06)
-- A agenda do profissional é o ativo mais escasso do negócio: dois atendimentos do mesmo
-- profissional NÃO podem colidir no tempo, mesmo sob concorrência (duas recepcionistas
-- marcando ao mesmo tempo). A checagem na app (ADR-08) é só UX de feedback antecipado; a trava
-- real precisa estar no banco, porque só o banco resolve a corrida.
--
-- ESCOPO desta migration (ADR-03): extensão btree_gist + constraint de exclusão sobre
-- appointments. Separada da ADR-02 em migration própria para manter cada migration coesa e
-- facilitar o diagnóstico se o `db reset` falhar neste passo.
--
-- Decisões de domínio já firmadas:
--   - Conflito é POR PROFISSIONAL DENTRO DO TENANT — `tenant_id with =` no índice reforça o
--     isolamento também na barreira de conflito (um tenant nunca bloqueia horário de outro) e
--     melhora a seletividade; profissionais diferentes não colidem.
--   - Agendamento `cancelado` ou `nao_compareceu` LIBERA o horário (partial WHERE), não conta
--     como conflito.
--   - Intervalo semiaberto `[starts_at, ends_at)` — `tstzrange(...)` default `[)`, então
--     encostar (ends_at de um = starts_at do outro) NÃO é conflito.
--
-- Idempotência: `add constraint` não aceita `if not exists` para exclusion constraints, então a
-- criação vai num bloco `do $$` que verifica `pg_constraint` antes de criar — mantém o
-- `db reset` re-executável sem erro. A extensão usa `create extension if not exists`.
--
-- Contrato para o frontend: violação levanta SQLSTATE `23P01` (exclusion_violation), que a app
-- mapeia para a mensagem pt-BR ("Este profissional já tem um agendamento neste horário.") no
-- mapa de erros da fundação (ADR-05/ADR-06/ADR-08). Nenhum segredo no SQL.

-- btree_gist permite combinar `=` de uuid (tenant_id, professional_id) com `&&` de range no
-- mesmo índice GiST da constraint de exclusão.
create extension if not exists btree_gist;

-- Constraint de exclusão: impede sobreposição de [starts_at, ends_at) para o MESMO
-- (tenant_id, professional_id) entre agendamentos em status ativo. Criada de forma idempotente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_no_overlap'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table appointments
      add constraint appointments_no_overlap
      exclude using gist (
        tenant_id       with =,   -- isolamento: só colide dentro do mesmo tenant
        professional_id with =,   -- conflito é por profissional
        tstzrange(starts_at, ends_at) with &&  -- faixas que se sobrepõem ([) semiaberto)
      )
      where (status not in ('cancelado','nao_compareceu'));  -- status inativo libera o horário
  end if;
end
$$;
