# ADR-02 — Pacotes backend: 1 tabela + RPCs venda/baixa/saldo

- Status: proposto

## Contexto

G6 exige pacotes de sessões (1 serviço, validade desde venda, baixa só ao `concluido`, vencido = venda nova, recepção vende mas não conclui baixa, comissão normal preço cheio — defaults §8 #1/#2/#3/#6/#8). Único backend novo permitido na Fase 2. Base: `clinical_records` (append-only + RLS + trigger, zero UI) como modelo; `appointment_payments` ledger append-only RF-24; `charges` PIX máx 1; `*_cents`/UTC; `tenant_id` do JWT.

## Decisão

Uma migration aditiva + 2–3 RPCs `SECURITY DEFINER` (única migration nova da Fase 2):

- Tabela `package_credits`: `id, tenant_id, customer_id, service_id, total_sessions, used_sessions, price_cents, expires_at, status` (+ `created_at`). `tenant_id` indexado + RLS por JWT; sem DELETE (estorno = linha/correção lógica, nunca update de valor).
- `sell_package(p_customer, p_service, p_total, p_price_cents)` — valida pacote ativo do catálogo/config, grava crédito com `expires_at = now() + validade`; RBAC: admin + receptionist podem vender.
- `redeem_session(p_credit_id, p_appointment_id)` — chamada SOMENTE na transição a `concluido` (trigger ou Edge existente, sem entidade nova); valida saldo > 0, não-expirado, mesmo tenant/serviço; incrementa `used_sessions`; comissão calculada sobre preço cheio (sem mudança no motor — default #8).
- `get_package_balance(p_customer_id)` — leitura escopada (saldo por cliente); recepção vê só "N restantes" (sem preço — filtro na UI, RLS igual).
- Cancelado não estorna (default #3); vencido não reabre — venda nova; foto/termo fora daqui.

## Consequências

- Positivas: backend mínimo, testável, reutiliza ledger/RBAC existentes; sem Edge nova, sem entidade sales, sem status novo.
- Negativas/risco: trigger de baixa acopla a `concluido` — mitigado com teste de integração (concluído baixa 1; cancelado não baixa; expirado recusa).
- LGPD: sem PII em log; `customer_id` nunca em URL/toast.

## Escopo

Entra: migration + RPCs + testes `db reset`. Não entra: nenhuma UI, nenhum flag, nenhuma mudança em comissão/ledger/PIX.

## Arquivos afetados

- `supabase/migrations/{timestamp}_package_credits.sql` (única migration nova)
- `supabase/functions/_shared/` ou SQL RPCs (mesmo arquivo se funções SQL puras)
- Testes integração PG real (`db reset` 2x): venda, baixa ao concluído, cancelado sem baixa, expirado recusa, RLS cross-tenant negado, recepção vende / não conclui baixa

## Critérios de aceite (testáveis)

1. `db reset` local 2x aplica sem erro; tabela tem `tenant_id` + índice + RLS ativa.
2. Venda cria crédito com `expires_at` correto; `used=0`.
3. Concluir atendimento com crédito válido → `used+1`; cancelar → `used` inalterado; crédito expirado/zerado → baixa recusada com erro tipado.
4. Tenant B não lê crédito do tenant A (RLS); receptionist vende mas `redeem` direto negado (quando aplicável via role).
5. Valores em `*_cents`, tempos UTC; nenhum log com telefone/nome.

## Dependência

ADR-01 (usa chaves `pacotes` no gating da futura UI, mas backend independente de UI — pode desenvolver em paralelo; contrato de leitura `get_package_balance` já prevê filtro recepção).
