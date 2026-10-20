-- Migration: vigência da grade + passo-base de slots em `professionals` (ADR-01 agenda)
-- Adiciona dois atributos NOVOS por profissional que a geração de slots (ADR-05) consome:
--
--   1. Vigência da grade — `schedule_start_date` / `schedule_end_date` (date, ambas opcionais).
--      Período [início, fim] em que o profissional atende (pedido do usuário, msg 10: "o
--      intervalo de dias que vai ser trabalhado"). Fora da vigência nenhum slot é ofertado mesmo
--      havendo grade semanal para o dia (RF-AG-01 / AC-12). null = sem limite naquela ponta.
--
--   2. Passo-base de slot — `slot_step_minutes` (int, default 30). Granularidade com que os
--      horários de início andam (RF-AG-04 / AC-15); modelagem do "tempo de consulta do
--      profissional" (msg 12.2). O profissional controla o PASSO de oferta; o BLOCO ocupado vem
--      sempre da duração do serviço (ADR-05/06). Faixa válida 5..240 min.
--
-- Por que em `professionals` (PRD §9 pontos 1/2, aprovados no gate): são um valor ÚNICO por
-- profissional, não por dia. Pô-los em `working_hours` duplicaria o dado por linha de dia e
-- abriria inconsistência entre dias.
--
-- Datas em `date` (dia de calendário no fuso do tenant; conversão para instante UTC só na
-- geração de slots, ADR-05), coerente com RNF-SEG-05. NÃO usar timestamptz aqui.
--
-- RBAC (PRD §9 ponto 3): escrita admin-only no MVP. A policy `professionals_write_admin` já
-- existente (20250217090000_operational_catalog.sql) cobre as colunas novas — NENHUMA policy
-- nova é criada. `tenant_id` já existe e já tem default `current_tenant_id()`
-- (20250218090000_operational_tenant_id_default.sql); RLS de `professionals` inalterada.
--
-- Migration NOVA (nunca editar migration aplicada — RNF-SEG-06). Idempotente no re-apply:
-- `add column if not exists` nas colunas e o CHECK de coerência protegido por guarda
-- `if not exists` no catálogo. `professionals` já existe
-- (20250217090000_operational_catalog.sql). Nenhum segredo no SQL.

alter table professionals
  add column if not exists schedule_start_date date,
  add column if not exists schedule_end_date   date,
  add column if not exists slot_step_minutes    int not null default 30
    check (slot_step_minutes between 5 and 240);

-- Coerência da vigência: quando AMBAS as datas presentes, início <= fim. null em qualquer uma
-- dispensa a checagem (sem limite naquela ponta). `add constraint` não é idempotente por si; a
-- guarda abaixo evita erro no re-apply.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'professionals_schedule_vigencia_coherent'
      and conrelid = 'professionals'::regclass
  ) then
    alter table professionals
      add constraint professionals_schedule_vigencia_coherent
      check (
        schedule_start_date is null
        or schedule_end_date is null
        or schedule_start_date <= schedule_end_date
      );
  end if;
end $$;
