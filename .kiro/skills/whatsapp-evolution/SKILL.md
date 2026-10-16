---
name: whatsapp-evolution
description: Conectar e disparar mensagens via Evolution API (WhatsApp) - pareamento por QR Code por tenant, envio de confirmação/lembrete/cobrança/comprovante, confirmação interativa D-1 e fila de retentativa. Use ao implementar o módulo de comunicação WhatsApp.
---

# Integração WhatsApp via Evolution API

Implementa RF08-RF11 e os disparos da régua (RF09, RF10, RF13, RF15). Evolution API roda em VPS;
cada tenant tem uma instância (`whatsapp_instances.evolution_instance_name`). Token e URL base
da Evolution são segredos de servidor — chamadas partem de Edge Functions, nunca do cliente.

> Confirmar endpoints/payloads na doc da versão da Evolution API em uso; a API evolui. Validar
> respostas com zod.

## Conexão por QR Code (RF08)

1. Admin abre painel de conexão → Edge Function cria/consulta a instância na Evolution.
2. Evolution retorna o QR (base64) → exibir no painel; `connection_status = aguardando_qr`.
3. Ao parear, status vira `conectado` (via polling do estado ou webhook da Evolution).
4. Persistir `last_connected_at` e refletir estado no painel.

## Envio de mensagens (templates)

Templates padrão (coluna `messages.template`): `confirmacao`, `lembrete_d1`, `cobranca`,
`comprovante`. Texto em pt-BR, personalizável por tenant nos planos que permitem.

```ts
await evolution.post(`/message/sendText/${instanceName}`, {
  number: toE164(customer.phone),      // só com whatsapp_opt_in = true (LGPD)
  text: renderTemplate('lembrete_d1', { nome, servico, dataHora }),
});
// registrar em `messages`: template, status, provider_message_id, payload
```

- **Consentimento LGPD:** só disparar para `customers.whatsapp_opt_in = true`.
- Registrar todo envio em `messages` com `status` (`fila|enviado|entregue|falha`).

## Confirmação interativa D-1 (RF10/RF11)

- 24h antes do `starts_at`: enviar lembrete com opções `[1] Confirmar` / `[2] Reagendar`
  (botões ou opção numérica, conforme suporte da instância).
- Receber a resposta via **webhook da Evolution** → casar com o agendamento (por telefone +
  janela de tempo / id de referência) → se confirmou, `appointments.status = confirmado` e
  `confirmed_at = now()`.
- Webhook de entrada: validar com zod, tratar como dado não confiável, ser idempotente
  (mesma resposta pode chegar repetida).

## Fila de retentativa (RNF04)

- Falha temporária de conexão não pode perder a mensagem.
- `messages.status = fila` → worker/cron (Edge Function agendada) tenta reenviar com backoff;
  marca `falha` só após N tentativas. Lembrete D-1 tem janela útil — não reenviar depois do
  horário do atendimento.

## Agendamento dos disparos

- **Confirmação imediata (RF09):** logo após criar o agendamento.
- **Lembrete D-1 (RF10):** job agendado (cron do Supabase / pg_cron ou scheduler externo) que
  varre agendamentos com `starts_at` entre 23h-25h à frente e ainda não lembrados.
- **Cobrança (RF13):** ao marcar `concluido` (coordenar com skill asaas-pix).
- **Comprovante (RF15):** após baixa do pagamento por webhook.

## Checklist

- [ ] Token/URL Evolution só no servidor.
- [ ] Disparo só com `whatsapp_opt_in`.
- [ ] Todo envio logado em `messages`.
- [ ] Webhook de entrada validado, idempotente e casado ao agendamento correto.
- [ ] Fila de retentativa com limite e respeito à janela útil do lembrete.
- [ ] Multi-tenant: instância e telefones isolados por `tenant_id`.
