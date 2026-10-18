-- Migration: appointments — compromisso profissional↔cliente↔serviço (ADR-02 agendamento base)
-- Cria a tabela `appointments`, coração operacional do produto (RF-D2): materializa o
-- compromisso num instante do tempo, com preço TRAVADO no ato (snapshot de services.price_cents)
-- e o ciclo de vida da máquina de estados. Sem esta tabela não há o que cobrar nem o que lembrar
-- nas fases seguintes.
--
-- ESCOPO desta migration (ADR-02): tabela + checks + índices + RLS/RBAC. A prevenção de conflito
-- (constraint de exclusão btree_gist) é a ADR-03 (migration própria) e a máquina de estados
-- (trigger BEFORE UPDATE OF status) é a ADR-04 — separadas para manter cada migration coesa e
-- facilitar diagnóstico se o `db reset` falhar num passo. Aqui o `status` é controlado apenas
-- pelo CHECK de enum; transições ainda não são guardadas.
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id` com índice por tenant e RLS
-- habilitado com policies USING + WITH CHECK ancoradas em `current_tenant_id()` (helper security
-- definer da Fase 2, reutilizado — NÃO recriado). O `tenant_id` NUNCA vem do cliente; o banco o
-- preenche por `default current_tenant_id()` (deriva do JWT/profiles) e as policies o confinam.
-- Lição confirmada (migration 20250218090000): sem o default, o WITH CHECK reprova a escrita do
-- cliente, que por regra de isolamento não envia tenant_id.
--
-- Coerência de tenant nas 3 FKs (defesa no banco, não só na UI): FK simples
-- `customer_id -> customers(id)` NÃO impede ligar um registro do tenant A a um agendamento do
-- tenant B. Fecha-se com FK COMPOSTA `(tenant_id, …)`, reusando os `unique (tenant_id, id)` que
-- customers (ADR-01), professionals e services (Fase 3) já expõem. Todas `on delete restrict`
-- (P6): apagar cliente/profissional/serviço com agendamento é barrado — a app usa soft-delete
-- (active=false), nunca DELETE físico; restrict protege o histórico.
--
-- Snapshot (P2): `price_cents` é cópia de services.price_cents no ato; `ends_at` é derivado na
-- app de `starts_at + service.duration_minutes`. Mudar o serviço depois não reescreve
-- agendamentos existentes — o valor cobrado é o do momento do agendamento.
--
-- RBAC (PRD §5):
--   admin / receptionist -> leem e gerem agendamentos de TODOS os profissionais do tenant.
--                           receptionist VÊ price_cents (dado operacional, não `charge`; charges
--                           não existe nesta fase) — coerente com o domínio.
--   professional         -> lê/escreve APENAS a própria agenda: os appointments cujo
--                           professional_id liga ao professionals do seu profile_id = auth.uid()
--                           (mesmo padrão de working_hours na Fase 3).
--   super_admin          -> nenhum caminho cross-tenant pelo cliente a esta tabela (fase futura
--                           via service role/Edge Function). Nenhuma policy *_super_admin aqui.
--
-- Convenções: inglês/snake_case/plural; dinheiro em `price_cents` inteiro; tempo em `timestamptz`
-- (UTC) — conversão para o fuso do tenant só na exibição/entrada da UI. Idempotente no re-apply
-- (create table if not exists / drop policy if exists). Nenhum segredo no SQL. Role de app
-- (`authenticated`) sem BYPASSRLS (herdado).

-- ============================================================================
-- appointments — compromisso profissional↔cliente↔serviço num instante do tempo.
-- ============================================================================
create table if not exists appointments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  customer_id     uuid not null,
  professional_id uuid not null,
  service_id      uuid not null,
  -- instante UTC; conversão para o fuso do tenant só na UI.
  starts_at       timestamptz not null,
  -- derivado na app de starts_at + service.duration_minutes (P2).
  ends_at         timestamptz not null check (ends_at > starts_at),
  -- snapshot de services.price_cents no ato (P2); dinheiro em centavos inteiro.
  price_cents     int not null check (price_cents >= 0),
  -- enum espelha APPOINTMENT_STATUSES de src/types/domain.ts; CHECK cobre o conjunto de valores,
  -- as transições (OLD->NEW) ficam para o trigger da ADR-04.
  status          text not null default 'pendente' check (
                    status in ('pendente','confirmado','em_atendimento','concluido','cancelado','nao_compareceu')
                  ),
  -- carimbado pela transição ao entrar em 'confirmado' (P1, ADR-04); nulo até lá.
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  -- FKs COMPOSTAS por tenant: um agendamento só liga a cliente/profissional/serviço do MESMO
  -- tenant (coerência no schema, não só na UI). on delete restrict protege o histórico (P6).
  constraint appointments_customer_fk
    foreign key (tenant_id, customer_id)
    references customers (tenant_id, id) on delete restrict,
  constraint appointments_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete restrict,
  constraint appointments_service_fk
    foreign key (tenant_id, service_id)
    references services (tenant_id, id) on delete restrict
);

-- particionamento lógico por tenant.
create index if not exists appointments_tenant_id_idx on appointments (tenant_id);
-- consulta principal da lista de agenda (por profissional + janela de dia, RNF01) e suporte à
-- policy de professional.
create index if not exists appointments_tenant_professional_starts_idx
  on appointments (tenant_id, professional_id, starts_at);
-- histórico do cliente.
create index if not exists appointments_tenant_customer_idx
  on appointments (tenant_id, customer_id);
-- filtros por status na lista (baixo custo).
create index if not exists appointments_tenant_status_idx
  on appointments (tenant_id, status);

alter table appointments enable row level security;

-- SELECT: admin/receptionist veem todos do tenant; professional só a própria agenda (os
-- appointments do professional ligado ao seu profile_id).
drop policy if exists appointments_select_tenant on appointments;
create policy appointments_select_tenant on appointments for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() in ('admin','receptionist')
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

-- WRITE (all): admin/receptionist gerem agendamentos de QUALQUER profissional do tenant.
-- WITH CHECK espelha o USING para barrar gravar linha de outro tenant (combinado com o default,
-- o INSERT do cliente — sem tenant_id — recebe o tenant do JWT e passa; cross-tenant barrado).
drop policy if exists appointments_write_staff on appointments;
create policy appointments_write_staff on appointments for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist')
  );

-- WRITE (all): professional APENAS nos agendamentos da própria agenda. Permissiva (OR) com a
-- policy de staff. WITH CHECK espelha o USING.
drop policy if exists appointments_write_own_professional on appointments;
create policy appointments_write_own_professional on appointments for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and professional_id in (
      select p.id from professionals p
      where p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and professional_id in (
      select p.id from professionals p
      where p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  );
