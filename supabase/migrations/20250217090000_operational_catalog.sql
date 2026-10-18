-- Migration: catálogo operacional do tenant (ADR-01 cadastro operacional)
-- Cria as 4 tabelas-base do cadastro operacional (RF03/RF04): `services`, `professionals`,
-- `service_professionals` (N:N) e `working_hours` (grade semanal). Sem catálogo não há agenda:
-- estas tabelas são o insumo direto do módulo de appointments/slots (fase seguinte, NÃO criada
-- aqui).
--
-- Isolamento multi-tenant (RNF03, inegociável): toda tabela carrega `tenant_id`, tem índice
-- por tenant e RLS habilitado com policies USING + WITH CHECK ancoradas em `current_tenant_id()`
-- (helper security definer da Fase 2, reutilizado — NÃO recriado). O `tenant_id` nunca vem do
-- cliente; as policies o derivam do JWT/profiles via `current_tenant_id()`.
--
-- Risco de fronteira específico (PRD §4): coerência de tenant no N:N e na grade. FK simples não
-- impede ligar `service_id` do tenant A a `professional_id` do tenant B. Fecha-se com FK
-- COMPOSTA `(tenant_id, …)`, o que exige `unique (tenant_id, id)` em `services` e
-- `professionals` como alvo referenciável.
--
-- Decisão de síntese confirmada pelo humano (PRD D5): `working_hours` é PERMISSIVO no banco —
-- sem unicidade por `(professional_id, weekday)` e sem barrar sobreposição de faixas (constraint
-- de exclusão/tstzrange é da fase de slots, fora de escopo). Horas da grade são `time` (grade
-- recorrente por dia da semana, não instante UTC) — não usar timestamptz aqui.
--
-- RBAC (PRD §5):
--   admin        -> CRUD completo das 4 tabelas dentro do tenant.
--   professional -> lê o catálogo; escreve apenas a própria `working_hours` (linhas do
--                   professional ligado ao seu profile_id = auth.uid()).
--   receptionist -> só leitura das 4 tabelas (inclusive services.price_cents, que é dado
--                   operacional, não `charge`). Sem policy de escrita.
--   super_admin  -> nenhum caminho cross-tenant pelo cliente a estas tabelas (fase futura via
--                   service role/Edge Function). Nenhuma policy *_super_admin criada aqui.
--
-- Convenções: inglês/snake_case/plural; dinheiro em *_cents inteiro; `created_at` timestamptz
-- (UTC); horas de grade em `time`. Idempotente no re-apply (if not exists / drop policy if
-- exists). Nenhum segredo no SQL. Role de app (`authenticated`) sem BYPASSRLS (herdado).

-- ============================================================================
-- 1. services — o que o tenant vende (duração + preço).
-- ============================================================================
create table if not exists services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  duration_minutes int not null check (duration_minutes > 0),
  price_cents      int not null check (price_cents >= 0),
  active           bool not null default true,            -- soft-delete por inativação; sem DELETE físico na app
  created_at       timestamptz not null default now(),
  -- alvo da FK composta do N:N (coerência de tenant no banco, não só na UI).
  constraint services_tenant_id_unique unique (tenant_id, id)
);

create index if not exists services_tenant_id_idx on services (tenant_id);

alter table services enable row level security;

-- SELECT: qualquer papel do tenant lê (preço de serviço é dado operacional, não `charge`).
drop policy if exists services_select_same_tenant on services;
create policy services_select_same_tenant on services for select
  using (tenant_id = current_tenant_id());

-- Escrita de catálogo: só admin do tenant. WITH CHECK espelha o USING para barrar gravar
-- linha de outro tenant.
drop policy if exists services_write_admin on services;
create policy services_write_admin on services for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- ============================================================================
-- 2. professionals — quem atende. profile_id liga ao login quando o profissional acessa.
-- ============================================================================
create table if not exists professionals (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  -- opcional e SOMENTE-LEITURA na app nesta fase (sem fluxo de convite). set null: se o
  -- profile some, o profissional operacional não evapora.
  profile_id uuid references profiles (id) on delete set null,
  active     bool not null default true,
  created_at timestamptz not null default now(),
  -- alvo das FKs compostas (N:N e working_hours).
  constraint professionals_tenant_id_unique unique (tenant_id, id)
);

create index if not exists professionals_tenant_id_idx on professionals (tenant_id);

-- Um login não liga a dois profissionais do mesmo tenant (P2). Parcial: só quando preenchido.
create unique index if not exists professionals_tenant_profile_unique
  on professionals (tenant_id, profile_id) where profile_id is not null;

alter table professionals enable row level security;

drop policy if exists professionals_select_same_tenant on professionals;
create policy professionals_select_same_tenant on professionals for select
  using (tenant_id = current_tenant_id());

drop policy if exists professionals_write_admin on professionals;
create policy professionals_write_admin on professionals for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- ============================================================================
-- 3. service_professionals (N:N) — quem executa cada serviço.
-- FKs COMPOSTAS por tenant: service_id e professional_id têm de ser do MESMO tenant da linha
-- de vínculo. Fecha o buraco cross-tenant no schema, não só na UI.
-- ============================================================================
create table if not exists service_professionals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  service_id      uuid not null,
  professional_id uuid not null,
  created_at      timestamptz not null default now(),
  constraint service_professionals_service_fk
    foreign key (tenant_id, service_id)
    references services (tenant_id, id) on delete cascade,
  constraint service_professionals_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete cascade,
  -- par único por tenant (sem vínculo duplicado).
  constraint service_professionals_unique unique (tenant_id, service_id, professional_id)
);

create index if not exists service_professionals_tenant_id_idx
  on service_professionals (tenant_id);
-- navegação dos dois lados do N:N.
create index if not exists service_professionals_tenant_service_idx
  on service_professionals (tenant_id, service_id);
create index if not exists service_professionals_tenant_professional_idx
  on service_professionals (tenant_id, professional_id);

alter table service_professionals enable row level security;

drop policy if exists service_professionals_select_same_tenant on service_professionals;
create policy service_professionals_select_same_tenant on service_professionals for select
  using (tenant_id = current_tenant_id());

drop policy if exists service_professionals_write_admin on service_professionals;
create policy service_professionals_write_admin on service_professionals for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- ============================================================================
-- 4. working_hours — grade semanal por profissional. FK COMPOSTA por tenant.
-- Permissivo (D5): sem unicidade por (professional_id, weekday); sobreposição NÃO barrada aqui.
-- ============================================================================
create table if not exists working_hours (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  professional_id uuid not null,
  weekday         smallint not null check (weekday between 0 and 6),  -- 0=domingo … 6=sábado
  start_time      time not null,
  end_time        time not null,
  break_start     time,
  break_end       time,
  created_at      timestamptz not null default now(),
  constraint working_hours_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete cascade,
  constraint working_hours_window check (start_time < end_time),
  -- intervalo ambos-ou-nenhum e, quando presente, coerente e dentro da janela.
  constraint working_hours_break_coherent check (
    (break_start is null and break_end is null)
    or (
      break_start is not null and break_end is not null
      and start_time <= break_start
      and break_start < break_end
      and break_end <= end_time
    )
  )
);

create index if not exists working_hours_tenant_id_idx on working_hours (tenant_id);
-- leitura da grade de um profissional.
create index if not exists working_hours_tenant_professional_weekday_idx
  on working_hours (tenant_id, professional_id, weekday);

alter table working_hours enable row level security;

drop policy if exists working_hours_select_same_tenant on working_hours;
create policy working_hours_select_same_tenant on working_hours for select
  using (tenant_id = current_tenant_id());

-- admin escreve a grade de qualquer profissional do tenant.
drop policy if exists working_hours_write_admin on working_hours;
create policy working_hours_write_admin on working_hours for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- professional escreve APENAS a própria grade: as linhas do professional cujo profile_id =
-- auth.uid(), no mesmo tenant. receptionist não tem policy de escrita -> só lê.
drop policy if exists working_hours_write_own_professional on working_hours;
create policy working_hours_write_own_professional on working_hours for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and exists (
      select 1 from professionals p
      where p.id = working_hours.professional_id
        and p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and exists (
      select 1 from professionals p
      where p.id = working_hours.professional_id
        and p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  );
