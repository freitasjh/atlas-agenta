---
name: asaas-pix
description: Integrar cobrança PIX via gateway Asaas - gerar QR Code e copia-e-cola, processar webhook de liquidação com idempotência e verificação de autenticidade. Use ao implementar o módulo financeiro, cobranças pós-atendimento ou baixa automática de pagamento.
---

# Integração Asaas (PIX dinâmico + webhook)

Implementa RF12-RF15: gerar cobrança PIX, disparar pós-atendimento, baixar por webhook,
enviar comprovante. Toda chamada ao Asaas e todo webhook rodam em **Edge Function com service
role** — a chave Asaas nunca vai ao cliente.

> Antes de codar endpoints/campos específicos, confirmar na doc oficial do Asaas a versão da
> API em uso, pois rotas e payloads mudam. Validar toda resposta externa com zod.

## Fluxo de cobrança (pós-atendimento, RF13)

1. Agendamento vira `concluido` → cria/recupera `customer` no Asaas → cria cobrança PIX pelo
   valor `price_cents`.
2. Persistir em `charges`: `gateway_charge_id`, `pix_payload` (copia e cola), `pix_qr_code`
   (imagem/base64), `status = pendente`.
3. Disparar WhatsApp (template `cobranca`) com o copia e cola + QR (usar skill whatsapp-evolution).

Esboço (pseudocódigo da Edge Function):
```ts
const charge = await asaas.post('/payments', {
  customer: asaasCustomerId,
  billingType: 'PIX',
  value: amountCents / 100,            // Asaas usa reais decimais
  dueDate: today(),
  externalReference: appointmentId,    // ajuda a conciliar
});
const pix = await asaas.get(`/payments/${charge.id}/pixQrCode`);
// persistir charge + pix.payload (copia e cola) + pix.encodedImage (QR)
```

## Webhook de liquidação (RF14) — regras duras

A rota de webhook DEVE:

1. **Verificar autenticidade.** Asaas envia um token configurável no header
   (`asaas-access-token`). Comparar com o segredo armazenado; rejeitar (401) se não bater.
2. **Ser idempotente.** O mesmo evento pode chegar mais de uma vez.
   - Deduplicar por `event.id` + `payment.id`. Guardar eventos processados (tabela
     `webhook_events` com unique em `provider_event_id`) e ignorar repetição.
   - Baixa dupla de pagamento é bug crítico — jamais marcar `pago` duas vezes.
3. **Validar o payload** com zod antes de usar.
4. Em evento `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`: achar `charge` por `gateway_charge_id`,
   setar `status = pago`, `paid_at = now()`, disparar comprovante (RF15).
5. Responder rápido (200) e fazer trabalho pesado de forma assíncrona/resiliente.

```ts
// idempotência
const { error } = await db.from('webhook_events')
  .insert({ provider_event_id: evt.id }); // unique
if (error?.code === '23505') return ok(); // já processado, ignora
```

## Dinheiro

- Internamente guardamos `*_cents` (inteiro). Asaas trabalha em reais decimais → converter nas
  bordas (`cents/100` ao enviar, `*100` ao receber), com arredondamento seguro.

## Segurança

- Chave de API Asaas e token do webhook: só em secrets do Supabase. Nunca no frontend, nunca
  em log.
- Ambiente: usar sandbox do Asaas em dev; URL base por variável de ambiente.

## Checklist

- [ ] Chave Asaas só no servidor (Edge Function).
- [ ] Webhook verifica token antes de processar.
- [ ] Idempotência garantida (dedup por evento).
- [ ] Payload validado com zod.
- [ ] Conversão centavos ↔ reais correta.
- [ ] Comprovante disparado só após baixa confirmada.
