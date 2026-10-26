-- Migration: tabela professional_commissions (taxa de comissão por profissional) — ADR-01 Fase 1b
-- Primeiro recurso de domínio profundo por ramo (barbearia): comissão por barbeiro. Esta migration
-- cria o lugar onde a TAXA (%) de comissão de cada profissional mora no banco. É a primeira unidade
-- de trabalho da fatia — o dado antes da tela que o consome e antes do gancho de apuração (ADRs
-- seguintes: appointment_commissions + trigger de 'concluido' + RPC de relatório).
--
-- Por que tabela própria e NÃO coluna em professionals (prd.md §7 D-1, analysis-data §6.2):
-- comissão é DADO FINANCEIRO SENSÍVEL (mesma classe de charges). A tabela `professionals` tem
-- `professionals_select_same_tenant` — SELECT aberto a TODO o tenant, inclusive receptionist e
-- todos os professional (20250217090000_operational_catalog.sql). RLS no Postgres é por LINHA, não
-- por COLUNA: não há como esconder só `commission_pct` numa tabela de leitura ampla sem quebrar a
-- leitura operacional (name, active, agenda). Column-level GRANT não combina bem com PostgREST/anon.
-- Por isso a taxa fica numa tabela própria, com a RLS financeira correta desde o schema, sem
-- regressão na leitura de professionals (clínica/salão intactos).
--
-- Transporte do percentual (prd.md §7 D-11, fechado nesta ADR): a coluna é `numeric(5,2)` —
-- percentual EXATO (nunca float; 0.00…100.00) e é a fonte de verdade da persistência. A UI
-- (ADRs de frontend) converte na borda a partir de um inteiro determinístico; o banco guarda
-- numeric(5,2). Percentual NÃO é dinheiro: o dinheiro apurado vem depois, em *_cents inteiro
-- (tabela appointment_commissions / trigger), com arredondamento half-up documentado lá.
--
-- Fronteiras (prd.md §4 / analysis-data §2, §6):
--   * Isolamento por tenant_id vindo SEMPRE de current_tenant_id() (JWT/profiles), NUNCA do
--     cliente. tenant_id not null default current_tenant_id() + índice + RLS, como appointments.
--   * segment NÃO entra em nenhuma cláusula de RLS — a comissão existe independentemente do ramo;
--     a trava é tenant_id/professional_id. O gating por barbearia é só de UI (frontend). Travar
--     RLS por segment transformaria dado de produto em fronteira de segurança (anti-padrão) e
--     arriscaria negar acesso a tenant legado (segment=null).
--   * RBAC financeiro: admin lê/escreve tudo do tenant; professional lê SÓ a própria taxa (via
--     professionals.profile_id = auth.uid()) e NÃO edita; receptionist NÃO lê (sem policy de
--     SELECT); super_admin sem caminho cross-tenant pelo cliente nesta fatia (nenhuma policy
--     *_super_admin aqui).
--   * FK COMPOSTA (tenant_id, professional_id) -> professionals (tenant_id, id): garante no schema
--     que a taxa é de um profissional do MESMO tenant (reusa professionals_tenant_id_unique).
--   * CHECK 0–100 é defesa em profundidade (a UI valida com zod antes).
--
-- Idempotente no re-apply: create table if not exists / create index if not exists / drop policy
-- if exists antes de cada create policy. `supabase db reset` deve terminar com exit 0 e não
-- duplicar objetos ao rodar duas vezes seguidas. Nenhum segredo no SQL. Role de app
-- (authenticated) sem BYPASSRLS. Última migration aplicada: 20250225091000 -> próximo livre
-- 20250226090000.

-- ============================================================================
-- Tabela: professional_commissions — uma linha por profissional por tenant.
-- ============================================================================
create table if not exists professional_commissions (
  tenant_id       uuid not null default current_tenant_id()
                    references tenants (id) on delete cascade,
  professional_id uuid not null,
  -- percentual exato (não float); 0.00…100.00. Dinheiro apurado vem depois em *_cents.
  commission_pct  numeric(5,2) not null default 0
                    check (commission_pct >= 0 and commission_pct <= 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- uma única taxa corrente por profissional por tenant.
  primary key (tenant_id, professional_id),
  -- FK COMPOSTA por tenant: a taxa é de um profissional do MESMO tenant (coerência no banco).
  constraint professional_commissions_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete cascade
);

-- Particionamento lógico multi-tenant.
create index if not exists professional_commissions_tenant_idx
  on professional_commissions (tenant_id);

alter table professional_commissions enable row level security;

-- SELECT (RLS financeira): admin vê tudo do tenant; professional vê SÓ a própria taxa
-- (professionals ligado ao seu profile_id = auth.uid()); receptionist NÃO lê (sem policy).
drop policy if exists professional_commissions_select on professional_commissions;
create policy professional_commissions_select on professional_commissions for select
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

-- Escrita (cadastro/edição da %): só admin do tenant. WITH CHECK espelha o USING para barrar
-- gravar linha de outro tenant. professional NÃO edita a própria taxa; receptionist não escreve.
drop policy if exists professional_commissions_write_admin on professional_commissions;
create policy professional_commissions_write_admin on professional_commissions for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');
