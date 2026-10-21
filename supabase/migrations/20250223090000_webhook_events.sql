-- Migration: webhook_events — idempotência + auditoria de entrada do WhatsApp (ADR-01 Fatia 2)
-- Materializa a superfície de domínio nova da Fatia 2: o registro de CADA evento de ENTRADA
-- recebido do provedor (Evolution) no webhook `whatsapp-inbound` (ADR-03). É a tabela onde
-- vivem a INVARIANTE DE IDEMPOTÊNCIA DE ENTRADA (R7) e a auditoria do casamento
-- resposta→agendamento (R8/R9/R10). Habilita a Edge Function de webhook (ADR-03): a função
-- grava aqui antes de aplicar qualquer efeito; a 2ª gravação do MESMO evento é barrada pelo
-- índice único e o processamento para antes do efeito.
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id not null references tenants` com RLS
-- habilitado. Diferente das tabelas escritas pelo cliente, aqui NÃO há `default
-- current_tenant_id()`: a linha é escrita SÓ pelo service role no webhook, que resolve o tenant
-- pela instância (`whatsapp_instances.evolution_instance_name → tenant_id`), NUNCA do payload e
-- nunca de JWT de usuário (o webhook é superfície pública sem JWT). Casar resposta ao
-- agendamento de outro tenant é proibido (R12) — o `tenant_id` fixa a linha ao tenant da
-- instância que recebeu.
--
-- RBAC (PRD §5 / ADR-01): auditoria de entrada pode conter sinais de intenção do cliente, então
-- é MAIS restrita que `messages`: SELECT só `admin` do tenant. Recepção/profissional NÃO leem
-- esta tabela. NENHUMA policy de INSERT/UPDATE/DELETE — a gravação é exclusiva do service role
-- (bypassa RLS). Sem policy de write, qualquer INSERT/UPDATE pelo cliente (role authenticated)
-- é negado por RLS — trava que impede forjar um evento de confirmação (R18).
--
-- Idempotência de ENTRADA (R7): índice único `(source, external_event_id)` — a trava REAL sob
-- concorrência. Reenviar o mesmo evento do provedor colide no índice; o webhook trata a colisão
-- como "já processado" e não repete o efeito.
--
-- FK composta por tenant (coerência no banco, não só na app): `appointment_id` liga ao
-- agendamento casado pelo PAR `(tenant_id, appointment_id) → appointments (tenant_id, id)`
-- (contra o `unique (tenant_id, id)` de 20250220089000). `on delete set null`: a auditoria do
-- evento sobrevive ao agendamento removido. `appointment_id` é NULLABLE (MATCH SIMPLE não valida
-- a FK quando nulo) — evento sem casamento (R8 "ignorado") é permitido.
--
-- PII mínima (RNF03/LGPD, R19): `payload` guarda SÓ metadados sem PII (sem telefone, sem
-- documento, sem o texto cru da mensagem — no máximo hash/rótulo). `failure_reason` é motivo
-- técnico curto. O número do remetente é usado em memória no webhook para o casamento, nunca
-- persistido aqui em claro.
--
-- Convenções: inglês/snake_case/plural; `created_at` timestamptz (UTC). Idempotente no re-apply
-- (create table if not exists / create index if not exists / drop policy if exists). Helpers
-- `current_tenant_id()` / `current_role_name()` (security definer, 20250216091000) reutilizados
-- — NÃO recriados. Nenhum segredo no SQL.

-- ============================================================================
-- webhook_events — auditoria + dedupe de eventos de ENTRADA do WhatsApp.
-- Uma linha por evento recebido do provedor.
-- ============================================================================
create table if not exists public.webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  -- resolvido pela instância no servidor (service role); NUNCA do payload/JWT.
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  -- provedor da origem; enum de 1 valor hoje, aberto a expansão futura.
  source             text not null default 'evolution' check (source in ('evolution')),
  -- id do evento vindo do provedor — chave de dedupe de entrada (R7).
  external_event_id  text not null,
  -- instância que recebeu o evento (correlaciona ao tenant via whatsapp_instances).
  instance_name      text not null,
  status             text not null default 'recebido'
                     check (status in ('recebido','processado','ignorado','rejeitado')),
  -- intenção interpretada; nullable (só preenchido quando o evento foi interpretado).
  parsed_intent      text check (parsed_intent in ('confirmar','reagendar','nao_reconhecido')),
  -- agendamento casado (nullable); FK composta garante mesmo tenant.
  appointment_id     uuid,
  -- metadados SEM PII (sem telefone/documento/texto cru em claro); no máximo hash/rótulo.
  payload            jsonb not null default '{}'::jsonb,
  -- motivo técnico curto quando status='rejeitado'; SEM PII.
  failure_reason     text,
  created_at         timestamptz not null default now(),
  -- coerência de tenant no banco: evento só liga a agendamento do MESMO tenant.
  constraint webhook_events_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete set null
);

create index if not exists webhook_events_tenant_id_idx on public.webhook_events (tenant_id);
create index if not exists webhook_events_tenant_appointment_idx
  on public.webhook_events (tenant_id, appointment_id);

-- Idempotência de ENTRADA (R7): a trava real sob concorrência. Reenviar o mesmo evento colide.
create unique index if not exists webhook_events_dedupe_uidx
  on public.webhook_events (source, external_event_id);

alter table public.webhook_events enable row level security;

-- SELECT: só admin do tenant (auditoria sensível de entrada; mais restrito que messages —
-- recepção/profissional NÃO leem). super_admin sem caminho pelo cliente a esta tabela.
drop policy if exists webhook_events_select_admin on public.webhook_events;
create policy webhook_events_select_admin on public.webhook_events for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

-- WRITE pelo cliente: NENHUMA policy de INSERT/UPDATE/DELETE. A gravação é exclusiva da Edge
-- Function com service role (bypassa RLS). Sem policy de write, qualquer INSERT/UPDATE pelo
-- cliente (role authenticated) é negado por RLS — trava que impede forjar um evento de
-- confirmação (R18).
