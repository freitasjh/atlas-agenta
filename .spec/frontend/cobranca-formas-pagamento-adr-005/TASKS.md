# TASKS — ADR-005 Relatórios financeiros admin, aba Recebimentos, RBAC final e docs

Convenção: teste-primeiro (teste vermelho → implementação → verde). `RF` = SPEC §8. `DoD` por task. Ordem = PLAN (RPC → hooks → painel → aba → hub/rota → docs → E2E).

## BE — RPC `financial_summary`

### T01 — Teste de integração da RPC (vermelho primeiro)
- **Caminho:** `supabase/tests/financial_summary.test.ts` (novo; ou `*.test.sql` se o repo adotar pgTAP — preferir vitest+Postgres real).
- **RF:** RF-20, RF-21, RF-24, RF-25, RF-26, RF-27.
- **BDD:** Dado tenant com atendimento quitado em dinheiro + gorjeta + cobrança pendente + linha estornada + PIX pago com ledger, quando `financial_summary` roda como admin/recepção/período inválido, então números batem (serviço≠gorjeta, pago 1×, estorno fora, pendente só em a receber) e não-admin recebe 403.
- **DoD:** seed + asserts de todos os cenários falhando sem a função (função inexistente); `supabase db reset` verde no resto.

### T02 — Migration `financial_summary`
- **Caminho:** `supabase/migrations/{timestamp}_financial_summary.sql` (novo).
- **RF:** RF-20, RF-29.
- **BDD:** Dado o SQL do ADR §2, quando aplicado, então função existe com `security invoker`, `search_path` fixo, `revoke public/anon` + `grant authenticated`, sem `p_tenant_id`, 366d e admin-check com `PT400`/`PT403`.
- **DoD:** T01 verde; `supabase db reset` limpo; `\df financial_summary` confere assinatura.

## FE — hooks

### T03 — `FinancialSummary` + `ReceivableRow` em tipos
- **Caminho:** `src/types/payments.ts` (estender).
- **RF:** RF-21, RF-28.
- **BDD:** Dado o contrato congelado, quando tipos importados nos hooks, então chaves batem com o JSON da RPC e `ReceivableRow` da aba.
- **DoD:** `tsc --noEmit` verde; nenhum campo `charges.pago` no tipo.

### T04 — Teste de `useFinancialSummary` (gating + zod)
- **Caminho:** `src/hooks/useFinancialSummary.test.ts` (novo).
- **RF:** RF-21, RF-29.
- **BDD:** Dado admin+payments / recepção / `payments=false` / sem timezone, quando hook monta, então só o primeiro dispara `rpc("financial_summary")` com `{p_from,p_to}` ISO e sem `tenant_id`; resposta inválida é rejeitada pelo zod.
- **DoD:** 4 gating + 1 zod vermelhos antes, verdes depois.

### T05 — `useFinancialSummary`
- **Caminho:** `src/hooks/useFinancialSummary.ts` (novo).
- **RF:** RF-20, RF-21.
- **BDD:** Dado `startDate/endDate YYYY-MM-DD`, quando query executa, então UTC via `tenantRangeUtc`, `queryKey ["financial-summary", from, to]`, `enabled = !!tz && canViewFinancials && payments===true`, `staleTime 30s`.
- **DoD:** T04 verde; invalidação em `["financial-summary"]` já coberta por `useAppointmentPayments`.

### T06 — Teste de `useReceipts` (paginação + filtros + RLS)
- **Caminho:** `src/hooks/useReceipts.test.ts` (novo).
- **RF:** RF-26, RF-28.
- **BDD:** Dado 30 linhas, quando página 1/2, então `range(0,24)`/`range(25,49)` com `count:exact`, filtros `method`/`situacao`/período aplicados, `enabled=false` fora do gating.
- **DoD:** asserts de `range`/filtros/gating vermelhos antes, verdes depois.

### T07 — `useReceipts`
- **Caminho:** `src/hooks/useReceipts.ts` (novo).
- **RF:** RF-26, RF-28.
- **BDD:** Dado gating ok, quando lista, então query direta `appointment_payments` sob RLS com embed clientes/operador (sem N+1), `order received_at desc`, zod na borda.
- **DoD:** T06 verde; recepção recebe 0 linhas/403 no teste de integração.

## FE — catálogo (sem literal)

### T08 — Catálogo `financialSummary.*` + `receipts.*`
- **Caminho:** `src/app/agenda/pagamentos/payments-messages.ts` (estender) + `src/app/agenda/pagamentos/payments-messages.test.ts` (estender).
- **RF:** RF-21, RF-28 (RNF-09).
- **BDD:** Dado o spy de literais, quando painel/aba renderizam, então zero string fora do catálogo (títulos, grupos, bases, nota caixa×competência, colunas, filtros, vazio/erro/retry, situações `Ativo/Estornada`).
- **DoD:** teste do spy verde; `tsc` com `Mutable<>` sem erro.

## FE — painel

### T09 — Teste do `FinanceiroPage`
- **Caminho:** `src/app/relatorios/__tests__/FinanceiroPage.test.tsx` (novo).
- **RF:** RF-21, RF-24, RF-25, RF-26, RF-27.
- **BDD:** Dado summary mockado (serviço+gorjeta+pendente+em aberto+5 métodos com zeros), quando renderiza, então 2 grupos com rótulos de base, 4 cards (sem quinto), total como linha, 5 linhas por-método, nota fixa, sem `svg` de gráfico; gating sem request.
- **DoD:** vermelho antes do componente; verde depois; a11y (`aria-label`, `aria-busy`) assertado.

### T10 — `FinanceiroPage`
- **Caminho:** `src/app/relatorios/FinanceiroPage.tsx` (novo).
- **RF:** RF-21, RF-24, RF-25, RF-27.
- **BDD:** Dado período via `PeriodFilter`, quando admin+payments, então `useFinancialSummary` + cards `tabular-nums` + `formatCentsToBRL` + datas no fuso tenant + estados loading/erro/vazio; sem ler `charges.pago`.
- **DoD:** T09 verde; 375/1280 sem scroll horizontal.

## FE — aba Recebimentos

### T11 — Teste do `RecebimentosTab`
- **Caminho:** `src/app/cobrancas/__tests__/RecebimentosTab.test.tsx` (novo).
- **RF:** RF-26, RF-28.
- **BDD:** Dado linhas ativas+estornada, quando aba abre, então colunas completas, `RealceRow` na estornada, filtros dentro do `TabsContent`, paginação 25, URL ↔ estado, sem totais/exportação/estorno/QR.
- **DoD:** vermelho antes; verde depois.

### T12 — `RecebimentosTab` + `CobrancasPage` com Tabs
- **Caminho:** `src/app/cobrancas/RecebimentosTab.tsx` (novo); `src/app/cobrancas/CobrancasPage.tsx` (editar).
- **RF:** RF-28, RF-31.
- **BDD:** Dado `?aba=recebimentos&de=&ate=&metodo=&situacao=&pag=`, quando navega, então tabs `pix`/`recebimentos`, trigger Recebimentos só sob gating, cada `TabsContent` com filtros próprios, skeleton/vazio/erro+retry.
- **DoD:** T11 verde; recepção não vê trigger no DOM.

## FE — hub/rota/RBAC/flag

### T13 — Card financeiro no hub + rota
- **Caminho:** `src/app/relatorios/RelatoriosHubPage.tsx` (editar); `src/router.tsx` (editar: `+ { path: "financeiro", element: <FinanceiroPage /> }`).
- **RF:** RF-21, RF-31.
- **BDD:** Dado admin+payments, quando hub abre, então card Financeiro visível (ícone `Wallet`); sem gating, card ausente e rota direta mostra neutro sem request.
- **DoD:** teste de hub (novo ou estendido) verde; rota sob `RequireRole admin` herdado.

### T14 — Testes RBAC + `resolveFeatures` (sem regressão)
- **Caminho:** `src/hooks/usePermissions.test.ts`, `src/hooks/useSegmentFeatures.test.ts` ou `src/lib/segment-features.test.ts` (estender).
- **RF:** RF-30, RF-31.
- **BDD:** Dado os 3 papéis × 4 segmentos, quando capacidades resolvidas, então matriz SPEC §5 e `payments` true só em salao/barbearia; `commission`/`combos` inalterados.
- **DoD:** todos os ramos assertados; suite existente sem regressão.

### T15 — Testes de fuso + dinheiro + i18n
- **Caminho:** junto aos testes acima (`datetime`/`money`/spy).
- **RF:** RF-20, RF-21 (RNF-05/06/08/09/12).
- **BDD:** Dado período no fuso tenant (incl. borda DST), quando `tenantRangeUtc` deriva, então janela semiaberta correta e `received_at`/`starts_at` exibidos via `formatDateInTenantTz`; centavos via `formatCentsToBRL` com `tabular-nums`.
- **DoD:** casos DST + `INVALID_PERIOD` (>366d) cobertos.

## DO — docs

### T16 — Atualizar `dominio.md` (+ espelho)
- **Caminho:** `.agents/rules/dominio.md` (+ `.kiro/steering/dominio.md` se existir).
- **RF:** RF-32.
- **BDD:** Dado o texto atual, quando revisado, então sem "gera cobrança PIX ao concluir"; com ledger fonte única, 5 métodos, PIX por escolha/máx 1, estados de pagamento, `pago+reservado+novo<=price`, gorjeta fora, estorno lógico, receita=ledger/`received_at`, a receber=snapshot.
- **DoD:** `grep -rn "gera cobrança PIX" .agents/rules/dominio.md` vazio; code review aprova.

### T17 — Atualizar `produto.md` + `seguranca-multitenant.md` (+ espelhos)
- **Caminho:** `.agents/rules/produto.md`, `.agents/rules/seguranca-multitenant.md` (+ `.kiro/steering/*` se existirem).
- **RF:** RF-31, RF-32.
- **BDD:** Dado os arquivos, quando editados, então produto registra formas/gating/parcial/gorjeta/PIX por escolha/RBAC; segurança registra RLS admin-only do ledger, Edge escopada, nenhum dado de cartão.
- **DoD:** sem toque em `stack.md`/`db-migration-supabase.md`/`harness.config.json`; review aprova.

## Encerramento

### T18 — Suite + build + E2E harness
- **Caminho:** repo inteiro (`npm test`, `tsc --noEmit`, `npm run build`, E2E manual).
- **RF:** todos (RNF-05/06/08/09/12).
- **BDD:** Dado tudo verde, quando E2E (wipe + admin vê painel/aba; recepção sem aba/card; gorjeta/estorno refletem), então console zero erros, 375/1280 ok, processos finalizados.
- **DoD:** `npm test` 0 falhas, build 0 erros, evidências no report; `workflow-state.json` + brain (`brain_store` decisão) atualizados.
