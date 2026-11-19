# ADR-06 — Fidelidade (D): backend (config, contas, transações, expiração/estorno)

- Status: proposto

## Contexto

Capacidade D exige programa de fidelidade por tenant: configuração de pontos, crédito na conclusão do atendimento, extrato, expiração e estorno em cancelamento (RF-17/RF-18/RF-22). Backend mínimo: `loyalty_accounts`, `loyalty_transactions` + config (pode residir em `tenant_settings` ou tabela dedicada).

## Decisão

1. Tabela `loyalty_programs` (1 por tenant):
   - `tenant_id pk`, `active boolean`, `points_per_real numeric/int`, `rounding text check (floor|nearest)`, `expiry_days int null`, `levels jsonb null`, `created_at`, `updated_at`.
   - RLS admin write/read; staff read se necessário para PDV.
2. Tabela `loyalty_accounts`:
   - `id`, `tenant_id`, `customer_id`, `balance_points int not null default 0`, `lifetime_points int`, `created_at`, `updated_at`.
   - FK composta; índice tenant/customer; RLS admin/receptionist read, customer? (app usa service role/Edge para cliente final indireto; RLS admin/staff).
3. Tabela `loyalty_transactions` (append-only):
   - `id`, `tenant_id`, `account_id`, `appointment_id` nullable, `type text check (credit|debit|expire|void)`, `points int not null`, `reason text`, `expires_at timestamptz null`, `voided_at/by/reason` para estorno lógico, `created_at`.
   - Índice por tenant/account/created_at.
4. RPCs:
   - `loyalty_accrue_on_conclude(appointment_id)` credita pontos conforme programa e preço do atendimento (`commission_base_cents`? usar `price_cents` do appointment), idempotente por appointment.
   - `loyalty_expire_sweep()` expira pontos vencidos (debit tipo `expire`).
   - `loyalty_void_for_cancelled_appointment(appointment_id)` estorna pontos creditados (não altera comissão; RF-24).
5. Regras:
   - Crédito ocorre na conclusão do atendimento (responde pergunta 3: conclusão), não no agendamento.
   - Pontos expiram conforme `expiry_days` (null = sem expiração).
   - Estorno de pagamento não altera pontos? Cancelamento de atendimento estorna pontos (RF-22); estorno financeiro segue ledger.
   - `tip_cents` fora da base de pontos (análogo a comissão).
   - Idempotência por appointment + tipo.

## Consequências

- Positivas: recorrência; extrato auditável; expiração controlada.
- Negativas/risco: concorrência no crédito (lock por account); pontos podem expirar parcialmente; definição de níveis opcional (pode ficar fora do MVP).
- Defaults PRD §7: cents/UTC, RBAC.

## Escopo

Entra: migrations, RPCs, triggers de conclusão/cancelamento, testes. Não entra: UI, cupons/gift cards, checkout.

## Arquivos afetados

- `supabase/migrations/<timestamp>_loyalty.sql`
- `supabase/migrations/<timestamp>_loyalty_rpcs.sql`
- Testes de integração

## Critérios de aceite (testáveis)

1. Conclusão de atendimento credita pontos uma única vez (replay não duplica).
2. Cancelamento estorna pontos creditados.
3. Expiração remove saldo vencido e registra transação `expire`.
4. Sem programa ativo, nenhum crédito.
5. Sem entitlement `fidelidade`, rotas/RPCs bloqueados e upsell.
6. RLS impede cross-tenant e leitura financeira indevida.

## Dependência

- ADR-01 (gating `fidelidade`)
- ADR-02 (appointment status/conclusão)
