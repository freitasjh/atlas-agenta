# ADR-02 — Depósito/sinal (A): schema backend mínimo

- Status: proposto

## Contexto

Capacidade A exige configuração de depósito por serviço, status `aguardando_deposito` no appointment, cobrança PIX pendente vinculada e RBAC (PRD RF-01/RF-02/RF-06, fronteira RLS). A base já tem `services`, `appointments`, `charges` com `appointment_id`. Não há tabela nova obrigatória se a config couber em `services` e a ligação reusar `charges.appointment_id`.

## Decisão

1. Estender `services` com colunas de depósito:
   - `deposit_enabled boolean not null default false`
   - `deposit_type text check (deposit_type in ('percent','fixed'))` (null quando desabilitado)
   - `deposit_value int not null default 0 check (deposit_value >= 0)` (% 0–100 ou centavos)
   - `deposit_deadline_hours int not null default 24 check (deposit_deadline_hours > 0)`
   - `deposit_refund_policy text not null default 'none' check (deposit_refund_policy in ('total','partial','none'))`
   - `deposit_refund_percent int check (deposit_refund_percent between 0 and 100)` (usado em `partial`)
   Escrita apenas admin do tenant (policy existente).
2. Estender `appointments.status` CHECK para incluir `aguardando_deposito`.
3. Reusar `charges.appointment_id` como vínculo; índice `charges(tenant_id, appointment_id, status)` se ausente. Nenhuma FK nova obrigatória.
4. Estender a guarda de transição `appointments_validate_transition()`:
   - `aguardando_deposito -> pendente | confirmado | cancelado`
   - `pendente -> aguardando_deposito` proibido (depósito é definido no agendamento público).
   - estados finais continuam imutáveis.
5. RLS/RBAC existentes permanecem; charge lida por admin/recepção conforme policy de `charges` (financeiro agregado não exposto a profissional).

## Consequências

- Positivas: backend mínimo, reuso de ledger/gateway; config por serviço; trava real no banco.
- Negativas/risco: mudança de CHECK/trigger exige migration idempotente; transição nova pode impactar testes de máquina de estados; necessidade de backfill nulo (sem dado legado).
- Defaults PRD §7: depósito opcional por serviço; no máximo uma cobrança PIX pendente por atendimento (garantido no fluxo ADR-03).

## Escopo

Entra: migration + trigger + índice + testes RLS/transição. Não entra: criação de charge, expiração, UI, campanhas/fidelidade.

## Arquivos afetados

- `supabase/migrations/<timestamp>_deposito_schema.sql`
- `supabase/migrations/<timestamp>_appointments_status_deposito.sql` (ou mesma migration, se coesa)
- Testes de integração de RLS/transição (`*IT`)

## Critérios de aceite (testáveis)

1. Admin cria/edita serviço com depósito; receptionist/professional não escrevem config.
2. `appointments.status` aceita `aguardando_deposito` e rejeita transição inválida (SQLSTATE 23514).
3. Sem entitlement `deposito`, backend ainda permite config? Gating é UI; RLS não depende de entitlement (defesa: rota bloqueada).
4. `supabase db reset` aplica migration sem erro; testes de transição verdes.
5. Cross-tenant: policy impede leitura/escrita de config/charge de outro tenant.

## Dependência

- ADR-01 (gating `deposito`).
