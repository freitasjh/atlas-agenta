---
inclusion: always
---

# Modelo de Domínio e Dados

Convenção: nomes de tabelas e colunas em **inglês, snake_case, plural** para tabelas. Todo dado
de negócio pertence a um tenant e carrega `tenant_id` (uuid) indexado.

## Entidades principais

### tenants (empresas assinantes)
- `id`, `legal_name` (razão social), `trade_name` (nome fantasia), `document` (CNPJ/CPF),
  `owner_email`, `phone`, `segment` (ramo), `plan` (`individual|clinica|pro`),
  `subscription_status` (`trial|ativo|pendente|bloqueado|cancelado`), `trial_ends_at`,
  `timezone` (default `America/Sao_Paulo`), `created_at`.

### users / profiles
- Autenticação via Supabase Auth. `profiles` liga `auth.users` a um `tenant_id` e a um
  `role` (`super_admin|admin|professional|receptionist`). Super admin pode não ter `tenant_id`.

### professionals
- `id`, `tenant_id`, `name`, `profile_id` (opcional, se o profissional loga), `active`.

### services
- `id`, `tenant_id`, `name`, `duration_minutes`, `price_cents`, `active`.
- `service_professionals` (N:N): quais profissionais executam cada serviço.

### working_hours (grade de horários)
- `id`, `tenant_id`, `professional_id`, `weekday` (0-6), `start_time`, `end_time`,
  `break_start`, `break_end`.

### customers (clientes finais do tenant)
- `id`, `tenant_id`, `name`, `phone` (E.164), `email`, `whatsapp_opt_in` (consentimento LGPD),
  `created_at`.

### appointments (agendamentos)
- `id`, `tenant_id`, `customer_id`, `professional_id`, `service_id`,
  `starts_at` (timestamptz, UTC), `ends_at`, `price_cents`,
  `status` (`pendente|confirmado|em_atendimento|concluido|cancelado|nao_compareceu`),
  `confirmed_at`, `created_at`.
- **Prevenção de conflito (RF06):** não permitir sobreposição `[starts_at, ends_at)` para o
  mesmo `professional_id`. Validar no banco (constraint de exclusão/`tstzrange`) e na aplicação.

### charges (cobranças PIX do gateway)
- `id`, `tenant_id`, `appointment_id` (opcional), `asaas_payment_id`, `amount_cents`,
  `pix_qr_code`, `pix_copy_paste` (copia e cola), `expires_at`,
  `status` (`pendente|pago|expirado|cancelado`), `paid_at`, `idempotency_key`, `created_at`.
- **Gateway-only**: representa a intenção/reserva (“a receber”), não receita. No máximo 1
  cobrança PIX por atendimento, **para sempre** (inclusive após paga).

### appointment_payments (ledger de recebimento)
- `id`, `tenant_id`, `appointment_id`, `charge_id` (opcional, só em `pix_sistema`), `method`
  (`dinheiro|cartao_credito|cartao_debito|pix_sistema|pix_maquininha`), `amount_cents`,
  `tip_cents`, `source` (`manual|asaas`), `idempotency_key`, `line_index`, `received_at`,
  `received_by`, `voided_at`, `voided_by`, `void_reason`, `created_at`.
- **Fonte única de receita**: receita = `sum(amount_cents)` das linhas com `voided_at is null`
  por `received_at` (caixa). Correção é estorno lógico (`voided_*`); update de valor e delete
  são proibidos.
- `tip_cents` (gorjeta) fica fora da receita de serviço e da base de comissão.
- Estados de pagamento do atendimento: `sem_pagamento|parcial|quitado|aguardando_pix`; total
  zero = `quitado` sem linhas. Invariante de parcela: `pago + reservado + novo <= price_cents`.

### messages (log de disparos WhatsApp)
- `id`, `tenant_id`, `customer_id`, `appointment_id` (opcional), `channel` (`whatsapp`),
  `template` (ex.: `confirmacao`, `lembrete_d1`, `cobranca`, `comprovante`),
  `status` (`fila|enviado|entregue|falha`), `provider_message_id`, `payload`, `created_at`.

### whatsapp_instances
- `id`, `tenant_id`, `evolution_instance_name`, `connection_status`
  (`desconectado|aguardando_qr|conectado`), `last_connected_at`.

## Máquina de estados do agendamento

```
pendente ──(cliente confirma D-1 / recepção confirma)──> confirmado
confirmado/pendente ──(início)──> em_atendimento ──(fim)──> concluido
qualquer ──> cancelado
confirmado/pendente ──(não veio)──> nao_compareceu
```

- Ao entrar em `concluido`: **não** cria cobrança PIX. O PIX do sistema só existe por escolha na
  parcela e no máximo 1 por atendimento, para sempre (inclusive após paga).
- Pagamento confirmado por webhook: `charges.status = pago` + linha em `appointment_payments`
  (`source = asaas`) + mensagem de comprovante (RF15).

## Regras de dinheiro e tempo

- Dinheiro em **centavos inteiros** (`*_cents`). Nunca float.
- Timestamps em **timestamptz (UTC)**. Conversão para o fuso do tenant só na exibição.
- **Receita** vem só de `appointment_payments` (`voided_at is null`, por `received_at` —
  caixa); “a receber” = snapshot de `charges.status = 'pendente'` com `asaas_payment_id` e não
  expirada. Cobrança paga nunca é somada como receita; nunca somar receita + a receber.
- `tip_cents` (gorjeta) fica fora da receita de serviço e da base de comissão.
- **Comissão inalterada**: continua no trigger de `concluido` sobre `appointments.price_cents`.
