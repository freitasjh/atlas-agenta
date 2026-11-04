# Modelo de Domínio e Dados — Atlas Agenda

Fonte: `.kiro/steering/dominio.md`. Regra descritiva.

## Convenção
Tabelas/colunas em inglês, snake_case, tabelas no plural. Todo dado de negócio pertence a tenant e carrega `tenant_id` (uuid) indexado.

## Entidades principais
tenants, profiles (liga auth.users a tenant_id + role super_admin|admin|professional|receptionist), professionals, services + service_professionals (N:N), working_hours, customers, appointments, charges (PIX), messages (WhatsApp), whatsapp_instances.

## appointments
status: pendente|confirmado|em_atendimento|concluido|cancelado|nao_compareceu. Prevenção de conflito (RF06): não permitir sobreposição [starts_at,ends_at) para mesmo professional_id. Validar no banco (exclusion constraint/tstzrange) e na aplicação.

## Máquina de estados
pendente → (confirmação D-1/recepção) → confirmado → (início) em_atendimento → (fim) concluido. Qualquer → cancelado. confirmado/pendente → (não veio) nao_compareceu. Ao entrar concluido: gera cobrança PIX + mensagem cobrança. Pagamento confirmado por webhook: charges.status=pago + comprovante.

## Dinheiro/tempo
Dinheiro em centavos inteiros (*_cents). Timestamps timestamptz UTC; conversão de fuso só na exibição.