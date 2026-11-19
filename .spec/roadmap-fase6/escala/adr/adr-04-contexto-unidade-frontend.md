# ADR-04 — Contexto de unidade no frontend (hook/provider + `?unidade` + query keys)

- **Status**: Aceito (design congelado)
- **PRD**: §6.2 RF-08..RF-14, §14 (contrato `UnitContext`), W7
- **UX-SPEC**: §2 D1/D2, §4 fluxo 1 e 3, §5 UnitSwitcher, §6 contratos invioláveis
- **Depende de**: ADR-01 (gate `multiUnidade`), ADR-02 (leitura de `units`), ADR-03 (lista filtrada por RLS)
- **Bloqueia**: ADR-09, ADR-10, ADR-11, ADR-13
- **Escopo de escrita**: `src/lib/`, `src/hooks/`, `src/app/AppLayout.tsx`, `src/router.tsx`

## Contexto

Hoje não existe dimensão de unidade no estado do frontend. Cada hook monta `queryKey` com os
próprios filtros (`useAppointments` → `[APPOINTMENTS_KEY, { day, professionalId, serviceId, status }]`).
Sem `unitId` na chave, trocar de unidade mostraria cache da unidade anterior — leitura falsa.
Sem uma fonte única de escopo, cada tela inventaria seu próprio seletor (W7: dois filtros
concorrentes).

Regras de produto: o seletor só existe com `units.length > 1 && multiUnidade === true`;
`?unidade` é a URL canônica (link compartilhável), `localStorage("atlas:unit")` é memória;
ausente → agregado; inválida → StatePanel **sem revelar nome alheio**; escrita nunca acontece
em agregado.

## Decisão

### D1 — Camada pura de resolução (`src/lib/unit-scope.ts`)

Função pura, sem React, que resolve o escopo a partir de três entradas: `searchParams`,
`localStorage`, lista de unidades permitidas (já filtrada pelo RLS). Saída:

- `mode`: `"all"` | `"single"`;
- `unitId`: `string | null` (nunca um id fora da lista permitida);
- `source`: `"url" | "storage" | "default"`;
- `denied`: booleano — `?unidade` presente e **não** presente na lista permitida (sem ecoar o
  valor cru em DOM/log).

Regras: URL válida vence; URL inválida → `denied` (não cai silenciosamente para storage);
sem URL → storage se válido; senão agregado. `tenant` de unidade única nunca persiste
`localStorage` (zero fricção).

### D2 — Provider único montado no `AppLayout`

`UnitProvider` envolve as rotas de `/app` dentro de `AppLayout` (mesmo ponto de
`useOnboardingSeed`). Expõe `useUnit()`:

| Campo | Tipo | Contrato |
|---|---|---|
| `mode` | `"all" \| "single"` | agregado = somente leitura |
| `unitId` | `string \| null` | `null` iff `mode="all"` |
| `units` | `UnitSummary[]` | somente unidades que o RLS devolveu |
| `isMulti` | `boolean` | `units.length > 1 && multiUnidade === true` |
| `isLoading` / `isError` | `boolean` | estados de lista |
| `setUnit(unitId \| null)` | função | grava `?unidade` + storage; invalida queries |
| `canWriteHere` | `boolean` | `mode="single"` **e** permissão de escrita do papel |
| `requireUnitId()` | `string` | lança/retorna erro de UI se `mode="all"` — usado por mutações |

`UnitProvider` **não** dispara request a `units` quando `multiUnidade` é `false`/`null`
(RF-34). Nesse caso, `mode="all"`, `units=[]`, `isMulti=false`, e nenhuma tela pergunta por
unidade (single-unit idêntico).

### D3 — Sincronização URL ↔ estado

`setUnit` usa `setSearchParams(..., { replace: true })` para não poluir o histórico; preserva
todos os outros parâmetros (período, filtros, rota). Drill-down de card de unidade navega para
a rota atual com `?unidade=<id>`, preservando `period`/filtros existentes (RF-14). Um
`popstate`/back que muda `?unidade` reaplica o escopo pela mesma função pura.

`localStorage` guarda **apenas** o id; um id que deixa de ser permitido é descartado na
leitura (nunca é reenviado). Chave: `atlas:unit`.

### D4 — Query keys com `unitId` (obrigatório)

Todo hook de dado escopável passa a compor a chave com o escopo:

- Chave base: `[domain, ...]`.
- Chave final: `[...base, { unitId }]` (ou `unitId` explícito quando a base já tem objeto).
- Query em agregado usa `unitId: null` **explícito** (nunca `undefined`), para não colidir com
  a chave de uma unidade.
- `setUnit` invalida por prefixo de domínio (`queryClient.invalidateQueries({ queryKey: base })`),
  não o cache inteiro; `staleTime` existente é preservado.
- Dados tenant-level (classe D do UX-SPEC) **não** recebem `unitId` na chave — continuam
  indiferentes ao escopo.

Helper `unitQueryKey(base, unitId)` em `src/lib/unit-scope.ts` para impedir composição
divergente entre hooks.

### D5 — Escrita em agregado é proibida na camada de dados

Toda mutação escopável chama `requireUnitId()` antes de montar o payload e envia o `unit_id`
operacional. Em `mode="all"`, a UI usa `canWriteHere=false` para desabilitar o CTA e a
mutação falha de forma explícita (nunca escolhe uma unidade "padrão" pelo usuário). A escolha
em agregado é sempre interstitial explícito (classe B).

### D6 — Classificação das telas

O provider expõe o escopo, não a política de classe. A classificação A/B/C/D vive em
`src/lib/unit-scope.ts` como mapa **declarativo** rota→classe, consumido pelas telas
(interstitial em B, leitura consolidada em C, indiferente em D). Rota não mapeada assume D
(nunca bloqueia navegação).

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `UnitContext` | `{ mode, unitId, units, isMulti, isLoading, isError, setUnit, canWriteHere, requireUnitId }` |
| `useUnit()` | erro se usado fora do `UnitProvider` |
| `resolveUnitScope(params, storage, allowed)` | puro; retorna `{ mode, unitId, source, denied }` |
| `unitQueryKey(base, unitId)` | `readonly unknown[]` estável |
| `atlas:unit` | única chave de storage; valor = id serializado |
| `?unidade` | único parâmetro de URL; inválido nunca é ecoado |

## Consequências

**Positivas**
- Uma única fonte de escopo; switcher, agenda, financeiro e relatórios falam a mesma língua.
- Isolamento de cache por unidade elimina leitura cruzada de dados em memória.
- Single-unit não muda: provider inerte com `isMulti=false`.

**Negativas / custos**
- Todo hook escopável precisa ser tocado para incluir `unitId` — mudança transversal e
  revisável por teste de chave.
- Duas fontes (URL + storage) exigem testes de precedência.

**Riscos e mitigação**
- *Risco*: hook esquecer `unitId` e servir cache da unidade anterior. *Mitigação*: teste por
  hook crítico (agenda, estoque, caixa) com troca de unidade e assert de nova request.
- *Risco*: `denied` revelar o id/nome alheio. *Mitigação*: `denied` é booleano; UI usa texto
  genérico; teste com id de outro tenant.
- *Risco*: `?unidade` em classe D quebrar rota. *Mitigação*: classe D ignora o escopo, mas
  mantém o parâmetro na URL.

## Escopo

**Entra**
- Função pura de resolução, provider, hook de unidades, query keys, guard de escrita,
  preservação de rota/período, mapa de classes.

**Não entra**
- Componente visual do switcher (ADR-09), telas (ADR-09/10/11), cache offline (ADR-13),
  escrita otimista, sincronização entre abas.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/lib/unit-scope.ts` (novo) + test | resolução pura, mapa de classes, query key |
| `src/hooks/useUnitContext.tsx` (novo) + test | provider/consumidor |
| `src/hooks/useUnits.ts` (novo) | lista RLS-filtrada + gate de entitlement |
| `src/app/AppLayout.tsx` | montar `UnitProvider` |
| `src/hooks/useAppointments.ts` | `unitId` na chave + payload de escrita |
| `src/hooks/useStock.ts`, `useWorkingHours.ts`, `useResources.ts` | `unitId` |
| `src/lib/queryClient.ts` | sem mudança de default; invalidação por prefixo nos hooks |

## Critérios de aceite (testáveis)

- [ ] `multiUnidade=false/null` → zero chamada a `units`; `isMulti=false`; telas idênticas.
- [ ] `?unidade` válida aplica escopo; recarregar a página mantém; link com a URL abre na
      mesma unidade.
- [ ] `?unidade` inválida → `denied=true`, StatePanel genérico, sem nome/id alheio no DOM.
- [ ] Sem URL e com storage válido → usa storage; storage inválido é descartado.
- [ ] Trocar de unidade invalida e refaz a request de agenda; nunca mostra dados da anterior.
- [ ] Mutação escopável em `mode="all"` falha explicitamente (sem unidade escolhida sozinha).
- [ ] Drill-down preserva rota e período; `setUnit` não empilha histórico.

## Dependência / ordem

Depois de ADR-03 (lista já filtrada por RLS). Antes de ADR-09/10/11; ADR-13 reusa a chave de
agenda do dia.
