# ADR-11 — UI de consolidação (dashboard, relatórios e financeiro com `UnitFilter`)

- **Status**: Aceito (design congelado)
- **PRD**: §6.4 RF-23..RF-26, §12 D2, W7
- **UX-SPEC**: §5 (`/app` agregado, relatórios, financeiro/PDV), §11 asserções
- **Depende de**: ADR-04 (contexto), ADR-06 (RPCs), ADR-07 (financeiro por unidade)
- **Bloqueia**: nada (folha da esteira de consolidação)
- **Escopo de escrita**: `src/app/dashboard/`, `src/app/relatorios/`, `src/app/financeiro/`, `src/components/UnitFilter.tsx`

## Contexto

Dashboard, relatórios e financeiro são classe **A**: no agregado mostram consolidado **com
quebra por unidade**, sem CTA primário de escrita. O risco W7 é ter dois filtros concorrentes:
o switcher global (chrome) e um filtro de relatório. A regra é: **switcher manda**; o
`UnitFilter` é recorte explícito do relatório (análise), não escopo de navegação. Além disso,
export CSV sem coluna de unidade e tabela com overflow em 375 são regressões previstas.

## Decisão

### D1 — Precedência de escopo (W7)

- Com switcher em **unidade**: todas as superfícies A mostram aquela unidade; `UnitFilter`
  aparece **desabilitado** (ou oculto) com explicação "Troque para Todas as unidades para
  comparar".
- Com switcher em **agregado**: `UnitFilter` (Todas / unidade específica) recorta o relatório
  **sem** alterar o contexto global nem a URL de navegação; usa parâmetro próprio de análise
  (`?unidadeFiltro=`), distinto de `?unidade`.
- Nunca dois recortes ativos contraditórios: a UI impede (disable + texto), não avisa depois.

### D2 — Dashboard agregado

- Hero (no-show e KPIs) + "Maior: {unidade}" no agregado.
- Bloco "Por unidade": barras de 6px com `role="img"` e valor textual ao lado (nunca só cor),
  ordem por volume desc, unidade inativa com `Badge secondary`.
- Drill-down: "Abrir unidade" (secundário) → `?unidade=<id>` preservando período/rota.
- Sem CTA primário de escrita no agregado (D2 do UX-SPEC); sempre loading/vazio/erro.

### D3 — Relatórios com comparativo

- `RelatoriosHubPage` e páginas de relatório recebem `UnitFilter` + coluna Unidade.
- "Comparativo entre unidades": `Table` ordenável em ≥768 (`aria-sort`, `caption`, `scope`),
  `<dl>` em 375 (sem overflow horizontal).
- CSV inclui coluna `unidade` e a UI avisa antes do download ("O arquivo inclui a coluna
  Unidade"). Ordenação/coluna refletem o recorte ativo.

### D4 — Financeiro

- `FinanceiroHubPage`, `DrePage`, `ReceberPage`, `CobrancasPage`: `UnitFilter` + coluna
  Unidade; DRE com bloco "Por unidade" em `Tabs` e bucket "Sem unidade" explícito.
- Regra receita × a receber preservada e visível (blocos separados, nunca soma).
- Export contábil com aviso de coluna; `Receber` mostra unidade derivada; `Cobranças` também.
- Recepção continua sem acesso ao financeiro agregado (policies existentes + `RequireRole`).

### D5 — PDV agregado (ponte com classe B)

No agregado, PDV não abre caixa "geral": interstitial com cards por unidade (aberto/fechado)
e CTA "Abrir PDV" que troca o escopo. Fechamento sempre com unidade derivada (ADR-07).

### D6 — Acessibilidade e performance

`aria-sort`/`caption`/`scope` em tabelas; alternativa em lista no mobile; `role=img` nas
barras; contraste AA nos dois temas; `tabular-nums`; alvos ≥44px; `scrollWidth <= innerWidth`;
sem request duplicada por render (chave estável com `unitId` + `unitFiltro`).

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `UnitFilter` | props `{ value: string \| null; onChange; disabled?: boolean; units: UnitSummary[] }`; `null` = todas |
| Parâmetro de análise | `?unidadeFiltro=<id>` (não muda `?unidade`) |
| Dashboard | hero + "Maior: X" + bloco por unidade + drill-down |
| Comparativo | tabela ordenável ≥768; `<dl>` em 375 |
| Export | coluna `unidade` + aviso pré-download |
| Precedência | switcher ≠ agregado ⇒ `UnitFilter` desabilitado com explicação |

## Consequências

**Positivas**
- Consolidação explícita, com drill-down e comparativo sem quebrar a regra de escopo.
- Export e DRE coerentes com o recorte.
- Regra de receita intocada.

**Negativas / custos**
- Dois parâmetros de escopo exigem disciplina de UI e testes (W7).
- Tabelas responsivas adicionam variantes (`<dl>` mobile).

**Riscos e mitigação**
- *Risco*: usuário achar que `UnitFilter` mudou a unidade global. *Mitigação*: rótulo
  "Recorte do relatório" + link "Trocar unidade" no switcher; teste de precedência.
- *Risco*: export sem unidade. *Mitigação*: teste de CSV com coluna e aviso.
- *Risco*: gráfico depender de cor. *Mitigação*: `role=img` + valor textual; teste de a11y.

## Escopo

**Entra**
- `UnitFilter`, dashboard agregado, comparativo, DRE por unidade, financeiro com coluna,
  exports com aviso, tabelas responsivas, estados.

**Não entra**
- Novos relatórios, métricas consolidadas de fase 3, rateio, mudança de permissões,
  redesenho de gráficos.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/components/UnitFilter.tsx` (novo) + test | filtro |
| `src/app/dashboard/DashboardPage.tsx` | hero + bloco por unidade + drill-down |
| `src/app/dashboard/` componentes | barras com `role=img` |
| `src/app/relatorios/RelatoriosHubPage.tsx` | comparativo |
| `src/app/relatorios/__tests__/` | ordenação/`<dl>`/CSV |
| `src/app/financeiro/FinanceiroHubPage.tsx` | filtro/coluna |
| `src/app/financeiro/dre/DrePage.tsx` | Tabs por unidade + "Sem unidade" |
| `src/app/financeiro/receber/ReceberPage.tsx`, `src/app/cobrancas/` | coluna/filtro |
| `src/lib/export-contabil.ts` | coluna unidade |

## Critérios de aceite (testáveis)

- [ ] Agregado: dashboard mostra hero + "Maior: X" + bloco por unidade; nenhum CTA primário.
- [ ] Drill-down abre a unidade preservando período e rota.
- [ ] Com unidade selecionada no switcher, `UnitFilter` fica desabilitado com explicação.
- [ ] Comparativo ordena por coluna (`aria-sort` alterna) e vira `<dl>` em 375 sem overflow.
- [ ] DRE por unidade exibe "Sem unidade" e não soma receita com a receber.
- [ ] CSV contém coluna `unidade` e aviso antes do download.
- [ ] Unidade inativa aparece marcada no bloco/relatório quando há dados.
- [ ] Recepção não acessa financeiro agregado.
- [ ] Barras têm `role=img` e valor textual; contraste AA nos dois temas.

## Dependência / ordem

Depois de ADR-06/07 e ADR-09/10 (switcher). Última das ADRs de consolidação.
