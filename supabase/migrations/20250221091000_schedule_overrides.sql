-- Migration: exceções por data da agenda — tabela `schedule_overrides` (ADR-02 agenda)
-- Sobrescreve a grade recorrente (`working_hours`) de um profissional num DIA específico. Dois
-- casos cobertos por uma única janela + flag `is_closed` (pedido do usuário, msg 11.1 "os dois"):
--
--   1. Bloqueio total (folga/feriado) — `is_closed = true`, SEM janela: nenhum slot nesse dia
--      (RF-AG-02 / AC-10).
--   2. Janela atípica — `is_closed = false`, janela diferente da grade recorrente, com break
--      opcional: a geração de slots (ADR-05) usa ESTA janela, não a do `weekday` (RF-AG-02 /
--      AC-11).
--
-- Unicidade por `(tenant_id, professional_id, override_date)`: uma exceção por profissional/dia,
-- sem ambiguidade de qual janela vale (AC-07). Paridade com `working_hours`: faixa única + break
-- ambos-ou-nenhum dentro da janela.
--
-- "Feriado do tenant inteiro" fica FORA do MVP (PRD §2.3 / §9 ponto 4): exceção é por
-- profissional/data; NÃO criar `tenant_holidays`.
--
-- Datas em `date` (dia de calendário no fuso do tenant); horas em `time` (`HH:MM`). Conversão
-- para instante UTC só na geração de slots (ADR-05), coerente com RNF-SEG-05 — NÃO usar
-- timestamptz nas horas de janela.
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id not null default
-- current_tenant_id()` (nunca vem do cliente), índice por tenant e RLS habilitado com policies
-- USING + WITH CHECK ancoradas em `current_tenant_id()`. FK COMPOSTA `(tenant_id,
-- professional_id)` → `professionals (tenant_id, id)` fecha o buraco cross-tenant no schema
-- (mesmo padrão de `working_hours`).
--
-- RBAC (PRD §5, espelha `working_hours`):
--   SELECT       -> qualquer papel do tenant (recepção precisa ver disponibilidade para marcar).
--   WRITE admin  -> exceção de QUALQUER profissional do tenant.
--   WRITE professional -> APENAS as próprias (professional ligado ao seu profile_id = auth.uid()).
--   receptionist -> SEM policy de escrita -> só leitura.
--   super_admin  -> nenhum caminho cross-tenant pelo cliente aqui.
--
-- Migration NOVA, timestamp posterior a ADR-01 (20250221090000). Idempotente no re-apply
-- (create table if not exists / if not exists em índices / drop policy if exists). Nenhum
-- segredo no SQL. `professionals`/`tenants` e os helpers `current_tenant_id()` /
-- `current_role_name()` já existem (fases anteriores).

-- ============================================================================
-- Tabela: schedule_overrides — exceção por profissional/data.
-- FK COMPOSTA por tenant: professional_id tem de ser do MESMO tenant da linha de exceção.
-- ============================================================================
create table if not exists schedule_overrides (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  professional_id uuid not null,
  override_date   date not null,
  is_closed       bool not null default false,            -- true = folga/feriado (sem janela); false = janela atípica
  start_time      time,
  end_time        time,
  break_start     time,
  break_end       time,
  reason          text check (reason is null or char_length(reason) between 1 and 200), -- rótulo opcional (ex.: "Feriado"), não-PII
  created_at      timestamptz not null default now(),
  constraint schedule_overrides_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete cascade,
  -- uma exceção por profissional/dia (AC-07).
  constraint schedule_overrides_unique unique (tenant_id, professional_id, override_date),
  -- coerência da janela (espelha working_hours_window + working_hours_break_coherent, AC-06):
  --   fechado  -> SEM janela e SEM break;
  --   aberto   -> janela coerente (start < end) e break ambos-ou-nenhum dentro da janela.
  constraint schedule_overrides_window check (
    (
      is_closed = true
      and start_time is null and end_time is null
      and break_start is null and break_end is null
    )
    or (
      is_closed = false
      and start_time is not null and end_time is not null
      and start_time < end_time
      and (
        (break_start is null and break_end is null)
        or (
          break_start is not null and break_end is not null
          and start_time <= break_start
          and break_start < break_end
          and break_end <= end_time
        )
      )
    )
  )
);

create index if not exists schedule_overrides_tenant_id_idx
  on schedule_overrides (tenant_id);
-- leitura das exceções de um profissional por data (geração de slots, ADR-05).
create index if not exists schedule_overrides_tenant_professional_date_idx
  on schedule_overrides (tenant_id, professional_id, override_date);

alter table schedule_overrides enable row level security;

-- SELECT: qualquer papel do tenant lê (recepção vê disponibilidade para marcar).
drop policy if exists schedule_overrides_select_same_tenant on schedule_overrides;
create policy schedule_overrides_select_same_tenant on schedule_overrides for select
  using (tenant_id = current_tenant_id());

-- admin escreve exceção de qualquer profissional do tenant. WITH CHECK espelha o USING para
-- barrar gravar linha de outro tenant.
drop policy if exists schedule_overrides_write_admin on schedule_overrides;
create policy schedule_overrides_write_admin on schedule_overrides for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- professional escreve APENAS as próprias exceções: linhas do professional cujo profile_id =
-- auth.uid(), no mesmo tenant. receptionist não tem policy de escrita -> só lê.
drop policy if exists schedule_overrides_write_own_professional on schedule_overrides;
create policy schedule_overrides_write_own_professional on schedule_overrides for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and exists (
      select 1 from professionals p
      where p.id = schedule_overrides.professional_id
        and p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and exists (
      select 1 from professionals p
      where p.id = schedule_overrides.professional_id
        and p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  );
