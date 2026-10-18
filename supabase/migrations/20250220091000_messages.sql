-- Migration: messages — log auditável de disparos WhatsApp (ADR-03 WhatsApp)
-- Materializa a entidade `messages` de dominio.md: o registro de cada disparo (template +
-- status + resultado do provedor) que torna o fluxo "enviar" rastreável. É a tabela onde vivem
-- as invariantes de IDEMPOTÊNCIA DE ENVIO e PII MÍNIMA EM LOG. Habilita a operação `send` da
-- Edge Function (ADR-04) e o histórico de mensagens na UI (ADR-07). Nesta fase só o disparo
-- SOB DEMANDA grava; régua automática / agendador / fila de retentativa são fase futura (NÃO
-- antecipar — o enum de template existe inteiro, mas nenhum disparo automático é implementado).
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id` com `default current_tenant_id()`
-- (deriva do JWT/profiles, NUNCA vem do cliente), índice por tenant e RLS habilitado. Helpers
-- `current_tenant_id()` / `current_role_name()` (security definer da Fase 2) reutilizados — NÃO
-- recriados. Lição confirmada (migration 20250218090000): sem o default, o WITH CHECK reprovaria
-- escrita do cliente — aqui, porém, o cliente NÃO escreve (ver bloco de WRITE abaixo).
--
-- FKs compostas por tenant (coerência de tenant no banco, não só na UI): ligam `messages` a
-- customers e appointments pelo PAR `(tenant_id, <id>)`, contra os `unique (tenant_id, id)` que
-- `customers` (20250219090000) e `appointments` (20250220089000, ADR-01) expõem. Uma mensagem
-- só casa com cliente/agendamento do MESMO tenant. `on delete restrict`: o log não some se o
-- cliente for removido (customers usa soft-delete de qualquer forma). `appointment_id` é
-- NULLABLE — o Postgres (MATCH SIMPLE) não valida a FK quando a coluna é nula, então mensagem
-- sem agendamento é permitida; quando preenchida, só casa com agendamento do mesmo tenant.
--
-- WRITE só service role (trava de integridade): NENHUMA policy de INSERT/UPDATE/DELETE aberta ao
-- cliente. A gravação é EXCLUSIVA da Edge Function com service role (que bypassa RLS após
-- autorizar por JWT/papel). Impede o front forjar um registro de envio ou pular opt-in /
-- idempotência. Mesmo espírito do insert de profiles/tenants (só via trigger security definer).
-- O cliente só LÊ o log e INVOCA a function.
--
-- RBAC de leitura (PRD §5): `messages` é log operacional de COMUNICAÇÃO, não dado financeiro —
-- por isso `receptionist` PODE ler (ao contrário de `charges`). `professional` também lê o log
-- do tenant nesta fase (recorte por profissional no log é fase futura — NÃO antecipar).
-- super_admin sem caminho cross-tenant pelo cliente (fase futura). Nenhuma policy *_super_admin.
--
-- Idempotência de envio (RNF04 parcial): índice único PARCIAL sobre `(tenant_id, dedupe_key)`
-- restrito a `status in ('fila','enviado','entregue')` — a trava REAL sob concorrência. Exclui
-- `falha` de propósito: um disparo falho (ex.: opt-in ausente) NÃO deve travar uma tentativa
-- legítima futura. A composição da `dedupe_key` fica na Edge Function (ADR-04), não em coluna
-- gerada — mantém a lógica no servidor e o schema simples.
--
-- PII mínima em log (RNF03/LGPD): `payload` guarda o texto renderizado/metadados e
-- `failure_reason` um motivo técnico curto — AMBOS SEM telefone/documento em claro. O vínculo
-- ao destino é `customer_id` (FK); o número é lido de customers no servidor quando necessário,
-- nunca duplicado no log. (Invariante de semântica/enforcement na function; o schema só provê o
-- lugar e o vínculo por FK.)
--
-- Convenções: inglês/snake_case/plural; `created_at` timestamptz (UTC). Idempotente no re-apply
-- (create table if not exists / create index if not exists / drop policy if exists). Nenhum
-- segredo no SQL. Role de app (`authenticated`) sem BYPASSRLS (herdado).

-- ============================================================================
-- messages — log de disparos de comunicação (WhatsApp nesta fase).
-- ============================================================================
create table if not exists messages (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  -- destinatário sempre existe; FK composta garante mesmo tenant.
  customer_id          uuid not null,
  -- nem todo disparo vem de agendamento; nullable (MATCH SIMPLE não valida FK quando nulo).
  appointment_id       uuid,
  -- canal do disparo; enum de 1 valor hoje, aberto a expansão futura.
  channel              text not null default 'whatsapp' check (channel in ('whatsapp')),
  -- espelha dominio.md; enum inteiro, mas nesta fase só o disparo sob demanda usa.
  template             text not null
                       check (template in ('confirmacao','lembrete_d1','cobranca','comprovante')),
  status               text not null default 'fila'
                       check (status in ('fila','enviado','entregue','falha')),
  -- nulo até o provedor responder; no mock é um id fake.
  provider_message_id  text,
  -- preenchido quando status='falha'; técnico curto, SEM PII.
  failure_reason       text,
  -- texto renderizado/metadados; SEM telefone/PII em claro. Vínculo ao destino é customer_id.
  payload              jsonb not null default '{}'::jsonb,
  -- chave natural de idempotência, composta pela Edge Function (ADR-04).
  dedupe_key           text,
  created_at           timestamptz not null default now(),
  -- coerência de tenant no banco: mensagem só liga a cliente/agendamento do MESMO tenant.
  constraint messages_customer_fk
    foreign key (tenant_id, customer_id) references customers (tenant_id, id) on delete restrict,
  constraint messages_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments (tenant_id, id) on delete restrict
);

create index if not exists messages_tenant_id_idx on messages (tenant_id);
create index if not exists messages_tenant_customer_idx on messages (tenant_id, customer_id);
create index if not exists messages_tenant_appointment_idx on messages (tenant_id, appointment_id);

-- Idempotência sob concorrência: índice único PARCIAL que cobre só os disparos que "contam"
-- como efetivos. Exclui `falha` para não travar retentativa legítima após opt-in.
create unique index if not exists messages_dedupe_uidx
  on messages (tenant_id, dedupe_key)
  where status in ('fila','enviado','entregue');

alter table messages enable row level security;

-- SELECT: qualquer papel operacional do tenant lê o log de comunicação (não é dado financeiro,
-- por isso receptionist também lê — ao contrário de charges). super_admin sem caminho pelo
-- cliente a esta tabela.
drop policy if exists messages_select_same_tenant on messages;
create policy messages_select_same_tenant on messages for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );

-- WRITE pelo cliente: NENHUMA policy de INSERT/UPDATE/DELETE. A gravação é exclusiva da Edge
-- Function com service role (bypassa RLS). Sem policy de write, qualquer INSERT/UPDATE pelo
-- cliente (role authenticated) é negado por RLS — trava que impede forjar envio ou pular
-- opt-in/idempotência.
