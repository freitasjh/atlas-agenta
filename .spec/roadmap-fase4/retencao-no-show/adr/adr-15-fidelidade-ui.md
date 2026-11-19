# ADR-15 — Fidelidade (D): UI

- Status: proposto

## Contexto

Capacidade D exige `/app/fidelidade` (config, cartão, cupons, gift cards), aba Fidelidade no CRM e aplicação no PDV (RF-17..RF-22, UX-SPEC D). Gating por entitlement `fidelidade`.

## Decisão

1. FidelidadePage (admin): config do programa (ativo, pontos por real, regras, expiração, níveis), cartão do cliente (saldo/extrato), criação de cupons e gift cards.
2. CRM: aba Fidelidade exibe saldo, extrato e cupons/gift cards do cliente.
3. PDV: aplicação de cupom (validação + desconto) e resgate de gift card (saldo consumido), com trilha de auditoria; estados loading/success/error.
4. Gating sem entitlement: upsell e nenhum request sensível.
5. Acessibilidade/responsividade conforme PRD §9.

## Consequências

- Positivas: recorrência e promoção controlada.
- Negativas/risco: complexidade de PDV; necessidade de testes de aplicação.
- Defaults PRD §9.

## Escopo

Entra: páginas/componentes/PDV/testes. Não entra: backend (ADR-06/07).

## Arquivos afetados

- `src/app/fidelidade/FidelidadePage.tsx`
- `src/app/clientes/...` (aba Fidelidade)
- `src/app/pdv/PdvPage.tsx`
- Testes `*.test.tsx`

## Critérios de aceite (testáveis)

1. Config persiste e programa ativo credita pontos.
2. Cartão/extrato exibem saldo correto.
3. Cupom/gift card aplicados no PDV com auditoria.
4. Sem entitlement, upsell e nenhum request sensível.
5. Console zero erros; breakpoints ok.

## Dependência

- ADR-01 (gating `fidelidade`)
- ADR-06/ADR-07 (backend)
- ADR-16 (CRM UI para aba)
