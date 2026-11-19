# ADR-09 — Varejo PDV UI (segmented Serviço|Produto|Combo)

- Status: proposto

## Contexto

UX-SPEC §4: segmented control Serviço | Produto (varejo) | Combo. Produto: select com estoque, stepper qty, preço read-only, total calculado, comissão preview (se canViewCommission). Esgotado desabilitado + alerta inline. Checkout PaymentCaptureDialog (reuso). RBAC: receptionist registra sem ver comissão? PDV exibe total da venda (necessário para cobrança). Base: ADR-05 (backend), ADR-01 (gating `estoque`? varejo depende de products; entitlement `comissaoProduto` para preview), segment `payments`.

## Decisão

Frontend:

- PdvPage: segmented control (shadcn Tabs ou ToggleGroup) com 3 opções; Combo só se `combos` feature.
- Produto: select de produtos ativos com estoque >0 (esgotado desabilitado + badge "Esgotado"); stepper qty (min 1, max estoque disponível); preço unitário read-only; total = qty*price; comissão preview se `canViewCommission` (admin/professional) e entitlement `comissaoProduto`.
- Validação: estoque insuficiente bloqueia submit (mensagem inline); submit envia selection.kind='product'.
- Checkout reusa PaymentCaptureDialog (total da venda exibido para cobrança).
- Gating: `payments === true` (segment) para exibir PDV; produto tab visível se há produtos ativos (sem entitlement específico além de `estoque`? Se `estoque===false`, tab Produto oculta/upsell).
- RBAC: receptionist vê total da venda (cobrança) mas não comissão preview; admin/professional veem comissão.

## Consequências

- Positivas: reuso de PaymentCaptureDialog; validação client + server; a11y (44px, foco).
- Negativas/risco: stepper acessível (aria-valuenow); testes de integração UI (vitest) + harness.
- Performance: select com busca/debounce se muitos produtos.

## Escopo

Entra: PdvPage alterações + componentes (ProductSelector, QtyStepper, CommissionPreview) + i18n + validação. Não entra: backend (ADR-05), estoque UI (ADR-08), comissão config (ADR-10).

## Arquivos afetados

- `src/app/pdv/PdvPage.tsx`
- `src/app/pdv/components/*` (novos)
- `src/lib/validations/pdv.ts`
- `src/i18n/messages/pt-BR.ts`, `en-US.ts`
- `src/app/pdv/PdvPage.test.tsx`

## Critérios de aceite (testáveis)

1. Segmented control alterna Serviço/Produto/Combo sem perder estado.
2. Produto esgotado desabilitado com alerta inline.
3. Qty > estoque bloqueia submit com mensagem.
4. Total calculado corretamente; preço read-only.
5. Comissão preview visível só para admin/professional com entitlement.
6. Receptionist vê total, não comissão.
7. 375/768/1024/1440 sem scroll-X; Console zero; dark mode; teclado.

## Dependência

ADR-05, ADR-01, ADR-08 (gating/estoque). ADR-04 (comissão preview).