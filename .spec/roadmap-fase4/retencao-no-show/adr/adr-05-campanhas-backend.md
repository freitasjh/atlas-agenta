# ADR-05 — Campanhas (C): backend (campanhas, envios, segmentação, consentimento)

- Status: proposto

## Contexto

Capacidade C exige templates por tenant, criação de campanha com presets/segmentação/agendamento, execução via WhatsApp com templates aprovados fora da janela de 24h e métricas de envio/entrega/resposta/conversão (RF-12..RF-16). Reuso de `TemplatesMensagemPage` como biblioteca. Backend mínimo: `campaigns`, `campaign_sends`. Consentimento obrigatório.

## Decisão

1. Tabela `campaign_templates` (se não reusar estrutura existente de messages/templates):
   - `id`, `tenant_id`, `name`, `body`, `variables jsonb`, `channel text default 'whatsapp'`, `approved_outside_24h boolean`, `created_at`.
   - RLS admin write, staff read.
2. Tabela `campaigns`:
   - `id`, `tenant_id`, `name`, `preset text check (win_back|birthday|rebooking|custom)`, `template_id`, `segment jsonb` (tags, última visita, no-show, serviço), `scheduled_at timestamptz`, `status text check (draft|scheduled|running|completed|cancelled)`, `created_by`, timestamps.
3. Tabela `campaign_sends`:
   - `id`, `tenant_id`, `campaign_id`, `customer_id`, `status text check (queued|sent|delivered|read|replied|converted|failed|excluded_opt_in)`, `provider_message_id`, `sent_at`, `delivered_at`, `read_at`, `replied_at`, `converted_appointment_id`, `failure_reason`, `created_at`.
   - Índice único `(tenant_id, campaign_id, customer_id)` para idempotência.
4. RPCs:
   - `campaign_preview_segment(campaign_id)` retorna contagem e excluídos por opt-in.
   - `campaign_enqueue(campaign_id)` cria `campaign_sends` apenas para clientes com `whatsapp_opt_in=true`; demais marcados `excluded_opt_in`.
   - `campaign_dispatch(campaign_id)` envia via Evolution/Edge em lote, idempotente por `campaign_send.id` + provider id.
   - `campaign_metrics(campaign_id)` agrega envios/entregas/leituras/respostas/conversões.
5. Regras:
   - Disparo fora da janela de 24h usa apenas templates aprovados (`approved_outside_24h=true`); dentro da janela, mensagem livre permitida (validação no Edge).
   - Opt-in obrigatório; consentimento registrado com data.
   - Limites de frequência/horário comercial configuráveis (pergunta 6) como parâmetros de campanha, com default seguro.
   - Conversão rastreada por link/origem ou appointment criado após envio dentro da janela configurada.

## Consequências

- Positivas: reativação consentida; métricas; reuso de templates.
- Negativas/risco: risco de ban se abuso (mitigar limites e métricas); dependência de status de entrega do provider; conversão atribuível aproximada.
- Defaults PRD §7: opt-in, janela 24h, idempotência.

## Escopo

Entra: migrations, RPCs, Edge dispatch, testes de idempotência/consentimento. Não entra: UI, fidelidade, CRM, relatórios.

## Arquivos afetados

- `supabase/migrations/<timestamp>_campaigns.sql`
- `supabase/functions/campaign-dispatch/*`
- `supabase/functions/whatsapp-webhook/*` (status updates)
- Testes de integração de consentimento/idempotência

## Critérios de aceite (testáveis)

1. Campanha em rascunho/agendada persiste segmentação e template.
2. Preview retorna contagem e excluídos por opt-in.
3. Enqueue não cria envio para cliente sem opt-in; marca `excluded_opt_in`.
4. Dispatch idempotente: replay não duplica envio.
5. Métricas agregam status corretamente.
6. Sem entitlement `campanhas`, rotas/RPCs bloqueados e upsell.

## Dependência

- ADR-01 (gating `campanhas`)
- ADR-08 (CRM/opt-in) recomendada para segmentação por tags/no-show; pode rodar em paralelo se opt-in já existir.
