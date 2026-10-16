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

### charges (cobranças PIX)
- `id`, `tenant_id`, `appointment_id`, `amount_cents`, `gateway` (`asaas`),
  `gateway_charge_id`, `pix_payload` (copia e cola), `pix_qr_code`,
  `status` (`pendente|pago|expirado|cancelado`), `paid_at`, `created_at`.

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

- Ao entrar em `concluido`: dispara geração de cobrança PIX + mensagem de cobrança (RF13).
- Pagamento confirmado por webhook: `charges.status = pago` + mensagem de comprovante (RF15).

## Regras de dinheiro e tempo

- Dinheiro em **centavos inteiros** (`*_cents`). Nunca float.
- Timestamps em **timestamptz (UTC)**. Conversão para o fuso do tenant só na exibição.
