# ADR-04 — Membership schema + RPCs (planos, adesão, cobrança, inadimplência)

- **Status**: `proposed`
- **Depende de**: ADR-03 (sequência de dados; sem acoplamento técnico — pode paralelizar após ADR-01).
- **RFs**: RF-07, RF-08, RF-11, RF-40 + fronteiras §7.

## Contexto

Recorrência/membership: planos por tenant, adesão do cliente, 1 cobrança pendente por ciclo, inadimplência com régua WhatsApp (opt-in, janela 24h). PRD §10.4–10.5 abertas (pacotes/cupons, dias p/ pausa). Base: `charges` gateway + `appointment_payments` ledger existem; membership não pode alterar o ledger.

## Decisão

- `membership_plans`: `id, tenant_id, nome, valor_cents, ciclo (mensal|trimestral|anual), ativo, created_at`.
- `membership_subscriptions`: `id, tenant_id, customer_id, plan_id, status (ativa|inadimplente|pausada|cancelada), proxima_cobranca_at, created_at`; check: 1 ativa/inadimplente por (customer, plan).
- `membership_charges`: `id, tenant_id, subscription_id FK composta, ciclo_ref, valor_cents, status (pendente|pago|vencido|cancelado), asaas_payment_id nullable, created_at`; unique parcial `(subscription_id, ciclo_ref)` onde status ≠ cancelado → 1 pendente por ciclo.
- RPCs service_role/Edge: `create-subscription-charge` (idempotente por ciclo), `handle-membership-webhook` (pago → subscription volta `ativa`, sem duplicar), `mark-overdue` (cron/job: pendente vencida → subscription `inadimplente` + evento WhatsApp opt-in).
- WhatsApp: reenvio só com `whatsapp_opt_in`; fora da janela 24h usa template aprovado.

## Consequências

- Positivas: cobrança recorrente idempotente; inadimplência é estado derivado, auditável.
- Negativas: pausa automática (dias p/ inadimplente→pausada) fica parametrizável sem default duro — PRD §10.5 delegada a config tenant (default 15d proposto, sem bloqueio).
- Riscos: webhook duplicado → dedupe por `asaas_payment_id` + evento id (padrão charges existente).

## Escopo

- Entra: migrations + RLS admin-only + RPCs/Edges + testes replay/webhook.
- Não entra: UI (ADR-05), planos do SaaS (catálogo `plans` intocado), pacotes/cupons (acumula? fora — §10.4 delegada).

## Arquivos afetados

- `supabase/migrations/*_membership.sql`
- `supabase/functions/create-subscription-charge/index.ts`, `supabase/functions/handle-membership-webhook/index.ts`
- `src/lib/membership.ts` (tipos + leitura RLS)

## Critérios de aceite (testáveis)

1. Adesão cria subscription `ativa` + 1 pendente no ciclo; segunda cobrança mesmo ciclo → mesma linha (idempotente).
2. Webhook pago → charge `pago`, subscription `ativa`; replay webhook → sem duplicar, sem segunda linha.
3. Vencida → `mark-overdue` marca `inadimplente` + fila WhatsApp só se opt-in; sem opt-in → sem mensagem (assert fila vazia).
4. RLS: recepção/profissional sem leitura; tenant A não vê B; `npm test` + reset verdes.
