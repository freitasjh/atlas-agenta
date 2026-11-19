# ADR-11 — Métricas WhatsApp (H): backend (KPIs, log filtrável, ban risk)

- Status: proposto

## Contexto

Capacidade H exige tabs Conexão/Mensagens/Métricas, KPIs (enviadas, entregues, lidas, confirmadas, respostas, falhas, ban risk) e log filtrável (RF-39..RF-41). Base tem tabela `messages` e Evolution. Backend mínimo: agregações/RPCs e retenção de métricas.

## Decisão

1. Estender `messages` (se necessário) com `status text`, `provider_message_id`, `delivered_at`, `read_at`, `failed_reason`, `campaign_id`, `template_name`, `direction text`.
2. RPCs admin only:
   - `whatsapp_kpis(period)` → contagens por status.
   - `whatsapp_message_log(period, status, template, direction, search, page)` → log filtrável.
   - `whatsapp_ban_risk(period)` → taxa de falha/bloqueio e limiar de alerta (pergunta 10).
3. Índices por tenant/status/created_at/provider_message_id.
4. RBAC: apenas admin vê métricas; receptionist/professional sem acesso.
5. Retenção: manter log por período configurável; agregados para KPIs.
6. Ban risk: definir limiar (ex.: falhas > X% ou bloqueios) e retornar nível de alerta + recomendação; não bloquear automaticamente sem decisão humana (pergunta 10).

## Consequências

- Positivas: operação do canal com visibilidade; risco de ban visível.
- Negativas/risco: dependência de status do provider (nem sempre preciso); métricas podem atrasar.
- Defaults PRD §7: opt-in, janela 24h, LGPD (minimizar PII).

## Escopo

Entra: migration, RPCs, testes de permissão. Não entra: UI, campanhas (consomem métricas).

## Arquivos afetados

- `supabase/migrations/<timestamp>_whatsapp_metrics.sql`
- `supabase/migrations/<timestamp>_whatsapp_metrics_rpcs.sql`
- Testes de integração

## Critérios de aceite (testáveis)

1. KPIs agregam corretamente por status.
2. Log filtra por status/template/direção/período.
3. Receptionist/professional recebem erro de permissão.
4. Ban risk retorna nível e limiar configurado.
5. RLS impede cross-tenant.

## Dependência

- ADR-05 (campanhas usam status de envio)
- ADR-08 (opt-in/consentimento)
