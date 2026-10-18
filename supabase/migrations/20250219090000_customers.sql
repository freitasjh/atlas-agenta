-- Migration: customers — cliente final do tenant (ADR-01 agendamento base)
-- Cria a tabela `customers`, destinatário final da comunicação e alvo de agendamento
-- (RF-D1). Sem cliente não há a quem marcar atendimento nem a quem disparar WhatsApp/PIX
-- nas fases seguintes. Guarda nome, telefone (E.164), e-mail opcional e o consentimento
-- LGPD (`whatsapp_opt_in`) — pré-requisito de qualquer disparo futuro ao cliente final.
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id` com índice por tenant e RLS
-- habilitado com policies USING + WITH CHECK ancoradas em `current_tenant_id()` (helper
-- security definer da Fase 2, reutilizado — NÃO recriado). O `tenant_id` NUNCA vem do
-- cliente; o banco o preenche por `default current_tenant_id()` (deriva do JWT/profiles)
-- e as policies o confinam. Lição confirmada (migration 20250218090000): sem o default, o
-- WITH CHECK reprova a escrita do cliente, que por regra de isolamento não envia tenant_id.
--
-- Soft-delete (P5): `active bool not null default true`. A app inativa em vez de DELETE
-- físico — preserva histórico de agendamentos (FK on delete restrict em appointments) e o
-- consentimento, coerente com a retenção LGPD enquanto houver relação.
--
-- Alvo de FK composta (coerência de tenant no banco): `unique (tenant_id, id)` permite que
-- appointments (ADR-02) referencie `(tenant_id, customer_id)` e garanta, no schema, que um
-- agendamento só liga a cliente do MESMO tenant — não só pela UI.
--
-- RBAC (PRD §5): todos os papéis operacionais (admin, receptionist, professional) leem e
-- escrevem clientes — o profissional precisa saber quem vem e pode cadastrar ao marcar na
-- própria agenda; não há dado financeiro em customers, então nada a esconder do
-- receptionist. super_admin não tem caminho cross-tenant pelo cliente a esta tabela (fase
-- futura via service role/Edge Function). Nenhuma policy *_super_admin aqui.
--
-- Convenções: inglês/snake_case/plural; `created_at` timestamptz (UTC). Idempotente no
-- re-apply (create table if not exists / drop policy if exists). Nenhum segredo no SQL.
-- Role de app (`authenticated`) sem BYPASSRLS (herdado).

-- ============================================================================
-- customers — cliente final do tenant.
-- ============================================================================
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 120),
  -- E.164 validado na app (zod); banco garante só não-vazio e tamanho são.
  phone           text not null check (char_length(phone) between 8 and 20),
  email           text,
  -- consentimento LGPD explícito, nunca presumido.
  whatsapp_opt_in bool not null default false,
  -- soft-delete por inativação; sem DELETE físico na app (P5).
  active          bool not null default true,
  created_at      timestamptz not null default now(),
  -- alvo da FK composta de appointments (ADR-02): coerência de tenant no banco.
  constraint customers_tenant_id_unique unique (tenant_id, id)
);

create index if not exists customers_tenant_id_idx on customers (tenant_id);
-- busca por telefone na tela de clientes. Sem unique por phone (o mesmo número pode
-- reaparecer legitimamente; dedupe fica para fase futura).
create index if not exists customers_tenant_phone_idx on customers (tenant_id, phone);

alter table customers enable row level security;

-- SELECT: qualquer papel operacional do tenant lê (admin/receptionist/professional).
-- super_admin sem caminho pelo cliente a esta tabela.
drop policy if exists customers_select_same_tenant on customers;
create policy customers_select_same_tenant on customers for select
  using (tenant_id = current_tenant_id());

-- Escrita: admin, receptionist e professional do tenant. WITH CHECK espelha o USING para
-- barrar gravar linha de outro tenant (combinado com o default, o INSERT do cliente — sem
-- tenant_id — recebe o tenant do JWT e passa; cross-tenant continua barrado).
drop policy if exists customers_write_tenant on customers;
create policy customers_write_tenant on customers for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );
