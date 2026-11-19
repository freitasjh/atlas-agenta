# ADR-10 — Meu plano + checkout self-service (G): backend (Asaas checkout + webhook)

- Status: proposto

## Contexto

Capacidade G exige evolução da PlanoPage com estados completos e checkout self-service via Asaas (RF-35..RF-38). Base tem catálogo de planos e entitlements. Backend mínimo: criação de checkout, webhook de atualização de plano/entitlements e estados de assinatura.

## Decisão

1. Reusar catálogo `plans` como SSoT; sem motor de entitlements novo.
2. Edge Function `create-checkout` (service role):
   - Valida tenant e entitlement `checkoutSelfService` (gating também na UI).
   - Cria cobrança/assinatura no Asaas para o plano selecionado (upgrade/downgrade).
   - Retorna URL de checkout e idempotency key.
3. Webhook Asaas (idempotente por evento):
   - Atualiza `tenant.plan`, status de assinatura (`trial|ativo|pendente|bloqueado|cancelado`), entitlements quando aplicável.
   - Registra fatura/histórico se existir tabela (reusar se houver; não criar financeiro completo).
4. Regras de timing:
   - Upgrade imediato (plano e entitlements atualizados após confirmação).
   - Downgrade com efeito no fim do ciclo de cobrança (pergunta 9), marcando `scheduled_plan`/`effective_at`.
   - Status `bloqueado` redireciona para quitação e bloqueia escrita operacional; `cancelado` arquiva e suspende disparos.
5. Segredos apenas em Edge Functions; cliente usa anon key.

## Consequências

- Positivas: reduz atrito comercial; autoatendimento.
- Negativas/risco: dependência de webhook; timing de downgrade; risco de inconsistência se webhook atrasar (mitigar status pendente + polling).
- Defaults PRD §7: idempotência, segredos.

## Escopo

Entra: Edge Functions, webhook, migration de campos de assinatura se faltarem, testes de idempotência. Não entra: UI, financeiro completo, multi-unidade.

## Arquivos afetados

- `supabase/functions/create-checkout/*`
- `supabase/functions/asaas-webhook/*` (extensão)
- `supabase/migrations/<timestamp>_tenant_subscription_fields.sql` (se necessário)
- Testes de integração

## Critérios de aceite (testáveis)

1. Checkout criado para tenant com entitlement retorna URL.
2. Webhook atualiza plano/status de forma idempotente.
3. Upgrade reflete entitlements após confirmação.
4. Downgrade agenda efeito no fim do ciclo.
5. Sem entitlement `checkoutSelfService`, checkout bloqueado e upsell.
6. Segredos não aparecem no bundle.

## Dependência

- ADR-01 (gating `checkoutSelfService`)
- ADR-02 (status de appointment não depende, mas bloqueio operacional por assinatura reusa regras)
