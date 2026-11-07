# Modelo de Domínio e Dados — Atlas Agenda

Fonte: `.kiro/steering/dominio.md`. Regra descritiva.

## Convenção
Tabelas/colunas em inglês, snake_case, tabelas no plural. Todo dado de negócio pertence a tenant e carrega `tenant_id` (uuid) indexado.

## Entidades principais
tenants, profiles (liga auth.users a tenant_id + role super_admin|admin|professional|receptionist), professionals, services + service_professionals (N:N), working_hours, customers, appointments, charges (cobrança PIX do gateway), appointment_payments (ledger de recebimento), messages (WhatsApp), whatsapp_instances.

## appointments
status: pendente|confirmado|em_atendimento|concluido|cancelado|nao_compareceu. Prevenção de conflito (RF06): não permitir sobreposição [starts_at,ends_at) para mesmo professional_id. Validar no banco (exclusion constraint/tstzrange) e na aplicação.

## Máquina de estados
pendente → (confirmação D-1/recepção) → confirmado → (início) em_atendimento → (fim) concluido. Qualquer → cancelado. confirmado/pendente → (não veio) nao_compareceu. Concluir **não** cria cobrança PIX: o PIX do sistema só existe por escolha na parcela e no máximo 1 por atendimento, para sempre (inclusive após paga). Pagamento confirmado por webhook: charges.status=pago + linha em appointment_payments (source=asaas) + comprovante.

## Receita e cobrança
`appointment_payments` é o ledger de recebimento (1:N por atendimento), fonte única de receita: receita = sum(amount_cents) das linhas com voided_at is null por received_at (caixa). Métodos v1: dinheiro, cartao_credito, cartao_debito, pix_sistema, pix_maquininha. `charges` é gateway-only: "a receber" = snapshot de charges.status='pendente' com asaas_payment_id e não expiradas (sem filtro de período); cobrança paga nunca é somada como receita, e receita + a receber nunca se somam. "Em aberto" = saldo de concluidos por starts_at (price - pago - reservado). Estados de pagamento: sem_pagamento|parcial|quitado|aguardando_pix; parcela nova respeita pago+reservado+novo <= price_cents. Correção é estorno lógico (voided_at/voided_by/void_reason); update de valor e delete são proibidos. `tip_cents` (gorjeta) fica fora da receita de serviço e da base de comissão. Comissão inalterada: continua no trigger de concluido sobre appointments.price_cents.

## Dinheiro/tempo
Dinheiro em centavos inteiros (*_cents). Timestamps timestamptz UTC; conversão de fuso só na exibição.
