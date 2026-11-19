# ADR-07 — Cupons e gift cards (D): backend + aplicação no PDV

- Status: proposto

## Contexto

RF-19..RF-21 exigem cupons (% ou fixo, validade, limite de uso, segmento) e gift cards (valor, validade, saldo parcial), aplicáveis no fechamento do PDV com trilha de auditoria. Perguntas 1/2 do PRD definem impacto no ledger. Decisão: cupom reduz total a pagar antes do registro; gift card é forma de pagamento `gift_card` no ledger, abatendo saldo.

## Decisão

1. Tabela `coupons`:
   - `id`, `tenant_id`, `code text unique per tenant`, `type check (percent|fixed)`, `value int` (% ou cents), `valid_from/until timestamptz`, `usage_limit int null`, `used_count int default 0`, `segment jsonb null`, `active boolean`, timestamps.
   - RLS admin write/read; staff read para validação.
2. Tabela `gift_cards`:
   - `id`, `tenant_id`, `code`, `initial_value_cents`, `balance_cents`, `valid_until`, `status check (active|exhausted|expired|cancelled)`, `issued_by`, timestamps.
3. Tabela `gift_card_redemptions`:
   - `id`, `tenant_id`, `gift_card_id`, `appointment_payment_id` nullable, `amount_cents`, `created_at`.
   - FK composta; append-only.
4. RPCs:
   - `coupon_validate(tenant, code, appointment context)` retorna desconto em cents e motivo de rejeição.
   - `gift_card_validate(...)` retorna saldo disponível.
   - `apply_coupon_to_closing(...)` calcula total final e registra uso (incrementa `used_count` com lock).
   - `redeem_gift_card(...)` consome saldo e cria redemption + `appointment_payments` linha método `gift_card`.
5. Regras de fechamento:
   - Cupom reduz total a pagar antes do registro no ledger; o valor pago pelas formas declaradas + gift card deve cobrir o total final.
   - Gift card é forma de pagamento `gift_card` no ledger (novo método) e abate saldo; saldo parcial permitido.
   - Desconto arbitrário continua proibido; apenas cupom de fidelidade (ou cupom válido) altera total.
   - Auditoria: registrar cupom/gift card aplicado no fechamento (appointment_payments ou metadata da charge? preferir campos `coupon_id`, `discount_cents` na tabela de fechamento/PDV se existir; se não, metadata jsonb do pagamento).
   - Expiração: cupom/gift card expiram conforme validade; gift card expirado não pode ser resgatado.
6. Idempotência por fechamento (payment idempotency key).

## Consequências

- Positivas: promoção controlada; gift card como receita no momento do resgate? Definir: venda de gift card é receita antecipada; resgate consome passivo. MVP pode registrar venda como receita e resgate como forma de pagamento sem nova receita (evita dupla contagem). Necessário documentar.
- Negativas/risco: complexidade contábil; risco de dupla contagem; concorrência no uso do cupom (lock).
- Defaults PRD §7: estorno lógico; sem delete.

## Escopo

Entra: migrations, RPCs, testes de validação/aplicação/idempotência. Não entra: UI, fidelidade pontos, relatórios.

## Arquivos afetados

- `supabase/migrations/<timestamp>_coupons_gift_cards.sql`
- `supabase/migrations/<timestamp>_coupon_giftcard_rpcs.sql`
- Testes de integração

## Critérios de aceite (testáveis)

1. Cupom válido reduz total; inválido/expirado/limite excedido é rejeitado.
2. Gift card consome saldo parcial e cria linha `gift_card` no ledger.
3. Tentativa de resgate acima do saldo é rejeitada.
4. Uso de cupom é idempotente por fechamento.
5. Sem entitlement `fidelidade`, validação/aplicação bloqueadas e upsell.
6. RLS impede cross-tenant.

## Dependência

- ADR-01 (gating `fidelidade`)
- ADR-06 (fidelidade base; cupom pode ser emitido por fidelidade)
