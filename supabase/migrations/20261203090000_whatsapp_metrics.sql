-- Migration: ADR-11 Fase 4 (H) — métricas WhatsApp: schema.
-- Escopo: estende `messages` (reuso, sem duplicar) + índices de apoio. RPCs vivem na
-- migration irmã `20261203091000_whatsapp_metrics_rpcs.sql`. Não toca UI (ADR-18).
--
-- Aditiva e idempotente (`add column if not exists`, `drop constraint if exists` +
-- `add constraint`, `create index if not exists`). Nenhuma migration aplicada é editada.
-- Padrão de widening de CHECK segue o precedente `20250223097000_fn_claim_retry_batch`
-- (estado `enviando`) e `20250223093000_reagendar_retorno_template` (5ª chave de template).
--
-- Decisões (resumo; detalhe nas RPCs):
--   1. Funil outbound cresce sem quebrar o envio atual: `lida` + `respondida` entram no CHECK
--      e no dedupe vivo (são envios efetivos — uma linha lida/respondida continua bloqueando
--      re-insert da mesma `dedupe_key`). A Edge `whatsapp`/`whatsapp-inbound` só escreve
--      fila/enviando/enviado/entregue/falha (zod e `.in()` intocados); `lida`/`respondida` são
--      gravadas pelo webhook de status do provedor (service role, ADR-12+).
--   2. `direction` (`saida` default p/ linhas legadas, `entrada` p/ futuras inbound) permite ao
--      log filtrar direção e às KPIs contar respostas sem nova tabela.
--   3. `template` ganha `resposta` (reply inbound livre) — mesmo padrão do `reagendar_retorno`.
--   4. `campaign_id` (nullable, FK composta por tenant) reusa `campaigns` (ADR-05): metrifica
--      régua + campanhas na mesma base, sem duplicar log.
--   5. `confirmadas` NÃO vive em `messages`: reusa `appointments.confirmed_via =
--      'cliente_whatsapp'` + `confirmed_at` no período (Opção A do PRD, determinística).
--   6. RLS de `messages` inalterada (log operacional segue legível p/ recepção/profissional —
--      decisão da migration `20250220091000`); o gate admin-only das MÉTRICAS vive nas RPCs
--      (PT403). RF-41 = acesso às métricas, não ao log operacional.
--   7. LGPD: `payload`/`failure_reason` seguem SEM telefone/documento em claro (regra da
--      migration base); o log das RPCs retorna `customer_id` + nome, nunca telefone.
--
-- Dinheiro: n/a. Tempo: timestamptz UTC. Inglês/snake_case/plural. Nenhum segredo no SQL.

-- ============================================================================
-- 1. Colunas novas (todas nullable ou com default seguro — insert atual não quebra).
-- ============================================================================
alter table public.messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists direction text not null default 'saida'
    check (direction in ('saida','entrada')),
  add column if not exists campaign_id uuid;

comment on column public.messages.delivered_at is
  'Carimbo do provedor: entregue. Base do KPI entregues.';
comment on column public.messages.read_at is
  'Carimbo do provedor: lida. Base do KPI lidas.';
comment on column public.messages.direction is
  'saida (disparo do tenant) | entrada (reply futuro do cliente). Default saida cobre legado.';
comment on column public.messages.campaign_id is
  'ADR-11: campanha de origem (ADR-05) quando o disparo pertence a uma campanha; null na régua.';

-- Coerência de tenant: mensagem só referencia campanha do MESMO tenant.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_campaign_fk'
  ) then
    alter table public.messages
      add constraint messages_campaign_fk
      foreign key (tenant_id, campaign_id)
      references public.campaigns (tenant_id, id) on delete restrict;
  end if;
end
$$;

-- ============================================================================
-- 2. Widening de CHECKs (precedente: enviando / reagendar_retorno).
-- ============================================================================
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages
  add constraint messages_status_check
  check (status in ('fila','enviando','enviado','entregue','lida','respondida','falha'));

alter table public.messages drop constraint if exists messages_template_allowed_check;
alter table public.messages drop constraint if exists messages_template_check;
alter table public.messages
  add constraint messages_template_allowed_check
  check (template in ('confirmacao','lembrete_d1','cobranca','comprovante','reagendar_retorno','resposta'));

-- Dedupe vivo inclui lida/respondida (envios efetivos bloqueiam re-insert igual).
drop index if exists messages_dedupe_uidx;
create unique index if not exists messages_dedupe_uidx
  on public.messages (tenant_id, dedupe_key)
  where status in ('fila','enviando','enviado','entregue','lida','respondida');

-- ============================================================================
-- 3. Índices de apoio às RPCs (filtro por status/direção/campanha + janela).
-- ============================================================================
create index if not exists messages_tenant_status_created_idx
  on public.messages (tenant_id, status, created_at);
create index if not exists messages_tenant_direction_created_idx
  on public.messages (tenant_id, direction, created_at);
create index if not exists messages_tenant_template_created_idx
  on public.messages (tenant_id, template, created_at);
create index if not exists messages_campaign_idx
  on public.messages (tenant_id, campaign_id)
  where campaign_id is not null;
create index if not exists messages_provider_message_id_idx
  on public.messages (provider_message_id)
  where provider_message_id is not null;
