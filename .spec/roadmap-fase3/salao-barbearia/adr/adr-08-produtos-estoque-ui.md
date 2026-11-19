# ADR-08 — Produtos & Estoque UI (ProdutosPage, EstoquePage, reposição, inventário)

- Status: proposto

## Contexto

UX-SPEC §3: ProdutosPage (CRUD, padrão ServicosPage, tabela desktop/cards mobile, gating plano+segmento, RBAC), EstoquePage (KPIs alertas, lista status OK/Baixo/Crítico, ações por linha), baixa por atendimento (Dialog, pré-selecionados, pode pular → pendência), reposição (form Card: produto, lote, validade, qtd, custo, fornecedor), inventário (wizard 2 etapas: escopo + contagem com diff âmbar, ajuste com motivo). Base: ADR-02/03, entitlement `estoque` (ADR-01), segment payments.

## Decisão

Frontend (React + shadcn/ui), mobile-first, i18n pt-BR, TanStack Query, react-hook-form+zod. Gating: se `estoque === false` → empty + upsell (não trava leitura). RBAC: receptionist registra baixa/reposição operacional sem financeiro (UI esconde totais/comissão).

- ProdutosPage: CRUD produto + N:N profissionais; filtro ativo; padrão ServicosPage.
- EstoquePage: KPIs (críticos/baixos), lista com badge status, ações (repor, ajustar, ver movimentações).
- Reposição: form Card → `replenish_stock`.
- Baixa por atendimento: Dialog ao concluir atendimento com produtos backbar pré-selecionados (pode pular → pendência registrada).
- Inventário: wizard 2 etapas (escopo por categoria → contagem com diff âmbar) → `adjust_stock` por item com motivo.
- Movimentações: lista paginada por produto.
- A11y: status não só cor (ícone+texto), 44px, foco, aria-live.

## Consequências

- Positivas: reusa padrões ServicosPage/PaymentCaptureDialog; gating claro; mobile-first.
- Negativas/risco: wizard 2 etapas exige estado local; testes de UI (vitest) + harness.
- Performance: paginação, debounce busca.

## Escopo

Entra: páginas/componentes/hooks/services/types + i18n. Não entra: backend (ADR-02/03), varejo PDV (ADR-09), comissão (ADR-10).

## Arquivos afetados

- `src/app/estoque/ProdutosPage.tsx`, `EstoquePage.tsx`, componentes (ProductFormDialog, ReplenishForm, InventoryWizard, StockMovementList)
- `src/hooks/useProducts.ts`, `useStock.ts`
- `src/lib/validations/estoque.ts`
- `src/i18n/messages/pt-BR.ts`, `en-US.ts`
- Rotas em router.

## Critérios de aceite (testáveis)

1. Gating: tenant sem entitlement `estoque` vê empty+upsell, sem crash e sem request de escrita.
2. RBAC: receptionist vê estoque e registra baixa/reposição; não vê totais/comissão (UI).
3. CRUD produto valida zod; esgotado desabilitado (badge).
4. Reposição grava movimento e aumenta saldo.
5. Inventário wizard: diff âmbar; ajuste com motivo obrigatório.
6. 375/768/1024/1440 sem scroll-X; Console zero; dark mode; teclado.

## Dependência

ADR-02, ADR-03, ADR-01. (Dados antes das telas.)