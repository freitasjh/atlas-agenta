# ADR-10 — Comissão: config (fórmula + backbar + produto) & relatório UI

- Status: proposto

## Contexto

UX-SPEC §5: Config: tipo de comissão serviço (% ou (preço−backbar)×%), % comissão, comissão por produto (%), backbar por serviço (opcional, fallback). Preview em tempo real. Relatório: coluna Origem (Serviço|Produto|Combo), breakdown por profissional, filtro Origem, tooltip fórmula. Base: ADR-04 (backend), ADR-01 (entitlement `comissaoProduto`), professional_commissions/services/products.

## Decisão

Frontend:

- Config (admin): form por profissional — tipo de comissão (select), % comissão, % comissão por produto (default do produto, editável? Decisão: lê de products; config global pode sobrescrever por profissional se necessário — MVP: só leitura do product.commission_pct, editável no produto). Backbar por serviço (input cents) opcional com fallback 0. Preview em tempo real (cálculo client-side espelhando fórmula).
- ProdutosPage (ADR-08): campo comissão % por produto.
- Relatório de comissões: coluna Origem (badge), breakdown por profissional, filtro Origem (select), tooltip fórmula (base, %, backbar, resultado). Reusa RPC `report_commissions` com `p_origin`.
- RBAC: admin vê tudo; professional vê próprias comissões; receptionist não vê relatório (gating UI + RLS).
- i18n pt-BR/en-US; a11y (tooltip acessível, tabela com caption/scope).

## Consequências

- Positivas: preview consistente com backend; relatório auditável; filtro por origem.
- Negativas/risco: preview deve espelhar exatamente a fórmula do backend (teste de paridade); arredondamento half-up.
- Performance: paginação no relatório.

## Escopo

Entra: páginas/componentes/hooks/services/i18n. Não entra: backend (ADR-04), estoque UI (ADR-08), PDV UI (ADR-09).

## Arquivos afetados

- `src/app/config/comissoes/*` (novos/alterados)
- `src/app/relatorios/ComissoesPage.tsx`
- `src/hooks/useCommissions.ts` (filtro origin)
- `src/lib/commission-formula.ts` (preview compartilhado)
- `src/i18n/messages/pt-BR.ts`, `en-US.ts`

## Critérios de aceite (testáveis)

1. Preview em tempo real bate com resultado do backend (teste de paridade com casos margin/price/produto/combo).
2. Relatório exibe coluna Origem e filtra por origem.
3. Tooltip fórmula mostra base, %, backbar, resultado.
4. RBAC: receptionist não acessa relatório (UI + RLS).
5. Gating: entitlement `comissaoProduto` false → config/preview de produto oculto/upsell.
6. 375/768/1024/1440 sem scroll-X; Console zero; dark mode; teclado.

## Dependência

ADR-04, ADR-01, ADR-02 (products.commission_pct), ADR-08.