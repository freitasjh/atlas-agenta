# ADR-04 — Comissão por produto + fórmula (preço−backbar)×% (backend)

- Status: proposto

## Contexto

G13 exige tipo de comissão serviço (% sobre preço ou (preço−backbar)×%), % comissão, comissão por produto (%), backbar por serviço; preview real-time; relatório com coluna Origem + breakdown + filtro. Base: `professional_commissions`, `appointment_commissions`, trigger `appointments_validate_transition` (comissão no `concluido`), `report_commissions` RPC. Precisa estender sem quebrar snapshot imutável (RF-24) e comissão existente (estorno não altera comissão).

## Decisão

Migration aditiva:

- `services`: add `backbar_cost_cents int not null default 0 check >=0` (backbar por serviço, opcional).
- `professional_commissions`: add `commission_type text not null default 'price' check in ('price','margin')` (tipo de comissão do serviço) e `product_commission_pct numeric(5,2) not null default 0 check 0..100`? Alternativa: comissão por produto vem de `products.commission_pct` (ADR-02). Decisão: produto usa `products.commission_pct` (já em ADR-02); profissional não sobrescreve comissão de produto no MVP. `professional_commissions` ganha apenas `commission_type` para serviço.
- `appointment_commissions`: add `origin text not null default 'service' check in ('service','product','combo')` e `backbar_cost_cents int not null default 0` (snapshot do backbar no ato, para tooltip/fórmula). `base_cents` continua preço (ou preço−backbar? Decisão: `base_cents` = preço do item; `commission_cents` calculado conforme fórmula; `backbar_cost_cents` snapshot para exibição). Para margin: `commission_cents = round((base_cents - backbar_cost_cents) * pct / 100)`; para price: `round(base_cents * pct / 100)`. Para produto: pct = `products.commission_pct`, origin='product'. Para combo: pct = professional pct tipo price (default), origin='combo'.
- Trigger `appointments_validate_transition`: ao entrar em `concluido`, determinar origin/pct/backbar conforme `appointments.product_id` (ADR-05) ou `combo_id` ou service; inserir snapshot com os campos novos. Idempotente (on conflict do nothing).
- `report_commissions` RPC: incluir `origin` e `backbar_cost_cents` no retorno; aceitar filtro `p_origin` (null = todos). Backward compat: campos novos com defaults.
- Estorno de pagamento não altera comissão (RF-24) — inalterado.

## Consequências

- Positivas: fórmula auditável via snapshot; relatório filtra por origem; sem quebrar comissão existente.
- Negativas/risco: trigger fica mais complexo → testes de integração obrigatórios (service price/margin, produto, combo, idempotência).
- LGPD: sem PII em log.

## Escopo

Entra: migration colunas + trigger update + RPC report + testes. Não entra: UI config/relatório, motor de quotas.

## Arquivos afetados

- `supabase/migrations/{ts}_commission_formula_product.sql`
- `supabase/migrations/...` (trigger recreate) — pode ser mesmo arquivo
- Testes integração: apuração service price/margin, produto, combo, origin, filtro RPC, idempotência, estorno não altera.

## Critérios de aceite (testáveis)

1. `db reset` 2x sem erro.
2. Atendimento de serviço com tipo `margin`: `commission_cents = round((price-backbar)*pct/100)`; com `price`: `round(price*pct/100)`.
3. Atendimento de produto: `commission_cents = round(price*product.commission_pct/100)`, origin='product'.
4. Combo: origin='combo'.
5. Relatório RPC retorna `origin` e filtra por `p_origin`.
6. Recalcular/reconcluir não duplica (idempotente).
7. Tenant B não lê comissão do tenant A.

## Dependência

ADR-02 (products.commission_pct) e ADR-01 (gating). ADR-05 (varejo) depende deste.