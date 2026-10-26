-- Migration: tabela appointment_commissions (snapshot imutável da comissão apurada) — ADR-02 Fase 1b
-- Ao concluir um atendimento, o sistema apura o valor da comissão a partir de
-- appointments.price_cents e PERSISTE UM SNAPSHOT IMUTÁVEL (prd.md §7 D-3/D-4, RF-C2/RF-C4). Esta
-- migration cria apenas a TABELA do snapshot; a função/trigger que a preenche no gancho de
-- 'concluido' é a ADR-03 (migration própria), mantendo cada migration coesa e facilitando o
-- diagnóstico se o `db reset` falhar num passo — mesmo padrão das migrations de appointments.
--
-- Por que SNAPSHOT e não derivação on-the-fly (prd.md §7 D-3/D-4, analysis-data §6.2):
--   * o relatório fica estável — mudar a taxa (professional_commissions) depois NÃO reescreve o
--     passado (AC-4);
--   * habilita idempotência por índice único (ver abaixo);
--   * gera fato histórico auditável — base_cents + commission_pct guardam COMO o valor foi apurado.
-- Coerente com price_cents de appointments, que já é snapshot do preço no ato
-- (20250219091000_appointments.sql). Percentual NÃO é dinheiro: commission_cents é o valor apurado
-- em centavos INTEIRO; o arredondamento half-up é aplicado no INSERT da ADR-03.
--
-- Idempotência (prd.md §4, RF-C3 — inegociável): concluir o mesmo atendimento não pode duplicar
-- comissão. Duas camadas de defesa: (1) a máquina de estados torna 'concluido' final
-- (20250219093000_appointments_state_machine.sql), (2) índice único (tenant_id, appointment_id) +
-- `on conflict do nothing` no INSERT da ADR-03 (nota brain idempotencia-partial-unique-index).
--
-- Fronteiras (prd.md §4 / analysis-data §2, §6):
--   * Isolamento por tenant_id vindo SEMPRE de current_tenant_id() (JWT/profiles), NUNCA do
--     cliente: tenant_id not null default current_tenant_id() + índice + RLS, como appointments.
--   * RLS FINANCEIRA na LEITURA: admin lê tudo do tenant; professional lê SÓ as próprias comissões
--     (via professionals.profile_id = auth.uid()); receptionist NÃO lê (sem policy de SELECT) —
--     espelha o tratamento de charges. O sigilo é na leitura, não na escrita.
--   * INSERT: WITH CHECK só tenant_id = current_tenant_id(), SEM restrição por papel — quem leva o
--     agendamento a 'concluido' (admin, receptionist, professional — ver policies de appointments)
--     participa do INSERT que roda dentro do trigger, no contexto do usuário. O tenant_id vem de
--     new.tenant_id, já confinado pela RLS do appointment → escrita cross-tenant impossível.
--   * SEM policy de UPDATE/DELETE — o snapshot é IMUTÁVEL.
--   * FK COMPOSTA (tenant_id, appointment_id) -> appointments (tenant_id, id): usa
--     appointments_tenant_id_unique (20250220089000). on delete cascade: apagar o agendamento
--     (fluxo de limpeza/tenant) leva junto a comissão derivada.
--   * FK COMPOSTA (tenant_id, professional_id) -> professionals (tenant_id, id) on delete restrict:
--     profissional é soft-delete (active=false); restrict protege o histórico apurado.
--
-- Idempotente no re-apply: create table if not exists / create index if not exists / drop policy
-- if exists antes de cada create policy. `supabase db reset` deve terminar com exit 0 e não
-- duplicar objetos ao rodar duas vezes seguidas. Nenhum segredo no SQL. Role de app
-- (authenticated) sem BYPASSRLS. Última migration aplicada da fatia: 20250226090000
-- (professional_commissions) -> próximo livre 20250226091000.

-- ============================================================================
-- Tabela: appointment_commissions — snapshot imutável da comissão apurada no 'concluido'.
-- No máximo uma linha por agendamento (idempotência via unique).
-- ============================================================================
create table if not exists appointment_commissions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id()
                    references tenants (id) on delete cascade,
  appointment_id  uuid not null,
  professional_id uuid not null,
  -- snapshots TRAVADOS no ato do 'concluido' (não re-derivar depois):
  -- base de cálculo = appointments.price_cents (centavos inteiro).
  base_cents      int not null check (base_cents >= 0),
  -- % aplicada no ato = professional_commissions.commission_pct vigente (exato, 0.00…100.00).
  commission_pct  numeric(5,2) not null
                    check (commission_pct >= 0 and commission_pct <= 100),
  -- valor apurado em centavos inteiro (half-up aplicado no INSERT da ADR-03).
  commission_cents int not null check (commission_cents >= 0),
  -- instante da apuração (= conclusão); eixo do relatório por período (ADR-04, prd.md §7 D-7).
  calculated_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  -- idempotência: no máximo uma comissão por agendamento por tenant.
  constraint appointment_commissions_appointment_unique
    unique (tenant_id, appointment_id),
  -- FK COMPOSTA por tenant do agendamento (coerência no banco); cascade com o appointment.
  constraint appointment_commissions_appointment_fk
    foreign key (tenant_id, appointment_id)
    references appointments (tenant_id, id) on delete cascade,
  -- FK COMPOSTA por tenant do profissional; restrict protege o histórico (soft-delete na app).
  constraint appointment_commissions_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete restrict
);

-- Particionamento lógico multi-tenant.
create index if not exists appointment_commissions_tenant_id_idx
  on appointment_commissions (tenant_id);
-- consulta principal do relatório: por período + por profissional (ADR-04).
create index if not exists appointment_commissions_tenant_prof_calc_idx
  on appointment_commissions (tenant_id, professional_id, calculated_at);

alter table appointment_commissions enable row level security;

-- SELECT (RLS financeira): admin vê tudo do tenant; professional vê SÓ as próprias comissões
-- (professionals ligado ao seu profile_id = auth.uid()); receptionist NÃO lê (sem policy).
drop policy if exists appointment_commissions_select on appointment_commissions;
create policy appointment_commissions_select on appointment_commissions for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'admin'
      or (
        current_role_name() = 'professional'
        and professional_id in (
          select p.id from professionals p
          where p.tenant_id = current_tenant_id()
            and p.profile_id = auth.uid()
        )
      )
    )
  );

-- INSERT: sem restrição por papel — quem conclui o agendamento (admin/receptionist/professional)
-- participa do INSERT que roda dentro do trigger, no contexto do usuário. WITH CHECK apenas
-- confina ao tenant; o tenant_id vem de new.tenant_id, já preso pela RLS do appointment →
-- escrita cross-tenant impossível. O sigilo financeiro é na LEITURA (receptionist sem SELECT).
drop policy if exists appointment_commissions_insert on appointment_commissions;
create policy appointment_commissions_insert on appointment_commissions for insert
  with check (tenant_id = current_tenant_id());

-- SEM policy de UPDATE/DELETE: o snapshot é imutável (nenhuma linha pode ser alterada/removida
-- pelo cliente; só o cascade da FK do appointment o remove).
