# ADR-03 — Depósito/sinal (A): fluxo público, confirmação, expiração e reembolso

- Status: proposto

## Contexto

RF-02..RF-05 exigem agendamento público com depósito, criação de charge PIX pendente, confirmação por webhook, expiração com liberação de slot e reembolso/cancelamento conforme política. Precisa manter idempotência, no máximo uma cobrança pendente por atendimento e reuso do ledger/gateway (PRD §7, domínio).

## Decisão

1. Fluxo de criação (Edge Function service role):
   - Valida serviço ativo com depósito habilitado e calcula valor do depósito (% ou fixo) em centavos.
   - Cria appointment em `aguardando_deposito` com `price_cents` do serviço.
   - Cria `charges` PIX pendente vinculada ao appointment (gateway Asaas), idempotente por chave `appointment_id + tipo deposito`.
   - Retorna QR/copia-e-cola e prazo (`deposit_deadline_at = now() + deposit_deadline_hours`).
2. Confirmação (webhook Asaas, idempotente por `gateway_charge_id` + evento):
   - Atualiza `charges.status='pago'`.
   - Transiciona appointment para `pendente` (ou `confirmado` se regra operacional assim definir) e carimba `confirmed_at` quando aplicável.
   - Dispara notificação WhatsApp opcional conforme `whatsapp_opt_in`.
   - Não cria linha em `appointment_payments` (depósito não é recebimento final; ledger continua fonte única na conclusão).
3. Expiração (job/cron ou verificação lazy):
   - Appointment `aguardando_deposito` com `deposit_deadline_at < now()` e charge pendente → cancelar com motivo `deposito_nao_pago`, expirar/cancelar charge, liberar slot.
   - Notificação ao cliente; idempotente.
4. Cancelamento/reembolso:
   - Se charge paga: aplicar `deposit_refund_policy` (`total`/`partial` via `deposit_refund_percent`/`none`), estorno lógico quando aplicável, cancelar charge no gateway quando suportado.
   - Se charge pendente: cancelar charge e appointment.
   - Ledger (`appointment_payments`) não é alterado por depósito; estorno de pagamento segue regra de estorno lógico separada.
5. Garantia de uma cobrança pendente por atendimento via índice parcial único `charges(tenant_id, appointment_id) where status='pendente' and charge_type='deposito'` (ou campo equivalente) e checagem no fluxo.

## Consequências

- Positivas: reduz no-show; slot liberado; idempotência; reuso de gateway/ledger.
- Negativas/risco: dependência de webhook/cron; edge cases de reembolso parcial exigem política clara (pergunta 7 do PRD); risco de duplicidade se webhook repetir (mitigado por chave).
- Defaults PRD §7: depósito não entra como receita.

## Escopo

Entra: Edge Function(s), webhook, job/cron lazy, RPCs de expiração/cancelamento, testes de idempotência. Não entra: UI, campanhas/fidelidade, alteração do ledger de recebimento.

## Arquivos afetados

- `supabase/functions/create-appointment-deposit/*` (ou equivalente)
- `supabase/functions/asaas-webhook/*` (extensão)
- `supabase/functions/expire-deposits/*` (ou RPC chamada por cron)
- `supabase/migrations/<timestamp>_deposit_charge_unique.sql`
- Testes de integração de idempotência/webhook

## Critérios de aceite (testáveis)

1. Agendamento público de serviço com depósito retorna PIX e cria appointment `aguardando_deposito` + charge pendente.
2. Replay do webhook não duplica transição nem notificação.
3. Expiração cancela appointment, charge e libera slot; segundo job não duplica.
4. Cancelamento com política `total/partial/none` aplica reembolso conforme config.
5. Tentativa de segunda charge pendente para o mesmo appointment é bloqueada (índice/teste).

## Dependência

- ADR-01 (gating `deposito`)
- ADR-02 (schema/transição)
