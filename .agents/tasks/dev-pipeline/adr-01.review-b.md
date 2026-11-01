# Review B — ADR-01: Trocar o `StatePanel` local da `CombosPage` pelo compartilhado

Substitui a definição local de `StatePanel` dentro de `CombosPage.tsx` pelo componente compartilhado `@/components/StatePanel`, removendo ~20 linhas de código duplicado e o `import * as React` que só existia por causa do tipo `React.ReactNode` daquela definição local. Refatoração pura, um arquivo, sem mudança de comportamento: o markup e as props (`{ titulo, descricao, children? }`) da cópia local eram byte-idênticos ao compartilhado, então os dois usos existentes (estado de erro e estado vazio) continuam apontando para o mesmo JSX. Alinha a `CombosPage` ao padrão já seguido por `AgendaPage`, `DashboardPage`, `RelatoriosHubPage` e `ComissoesPage`, e prepara o terreno para o guard da ADR-02 consumir literalmente o mesmo componente.

Watch for: nenhum item bloqueante. (confirmed)

**Verdict**: APPROVED

## High-level view

A troca é mecânica e verificável por inspeção. A função local removida e o componente compartilhado têm o mesmo conjunto de props, a mesma string de `className` (`mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center`), a mesma hierarquia `h2` + `p` + slot condicional de `children`. Logo AC-01.2 (erro e vazio renderizam idênticos ao PR #15) se sustenta sem necessidade de screenshot — o DOM gerado é o mesmo.

A remoção do `import * as React` é correta e não é efeito colateral indevido: após remover a definição local, não sobra nenhuma referência a `React` no arquivo (confirmado por grep), e o projeto usa o JSX transform novo, que não exige import explícito. O `typecheck` pegaria uma referência órfã; passou limpo.

Sobre fronteiras: a ADR não toca dados. Nenhuma migration, RLS, RPC, Edge Function, segredo, webhook ou PII entra no diff — só um import e a remoção de uma função de apresentação. Multi-tenant/RLS/RBAC/idempotência/LGPD não são afetados por esta ADR; o gating por `segment` e o RLS por `tenant_id` do PR #15 permanecem intactos (e o gating em si é assunto da ADR-02, fora deste escopo). Design doc React respeitado: reutilização de `src/components` em vez de recriar, exatamente a diretriz de `convencoes-codigo.md`.

A contraprova fecha: `typecheck`, `build` e `test` (89 testes, incluindo `segment-features.test.ts`) verdes.

<details>
<summary>Issues (0)</summary>

Nenhuma issue acionável. ADR aprovada.

</details>

<details>
<summary>Details</summary>

### Diff conforme à ADR, sem extras

O commit `9a7fe9b` altera exatamente um arquivo (`src/app/config/combos/CombosPage.tsx`, 1 inserção / 24 remoções) e faz exatamente as três coisas que a Decisão da ADR-01 lista: adiciona `import { StatePanel } from "@/components/StatePanel";`, remove a função `StatePanel` local inteira e deixa os dois usos (erro/vazio) apontando para o componente importado. A quarta mudança — remover `import * as React from "react"` — não está escrita como passo na ADR, mas é consequência necessária e benigna da remoção (era o único consumidor de `React` no arquivo). Nada além disso foi tocado: `ComboStatusBadge`, `ComboServicesSummary`, hooks, diálogos e caminho de dados estão inalterados. (confirmed)

### Equivalência de render (AC-01.2)

Comparando a definição removida com `src/components/StatePanel.tsx`:

- Props: ambas `{ titulo: string; descricao: string; children?: React.ReactNode }`.
- Container: `div` com `mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center` em ambos.
- Título: `h2` com `font-display text-lg font-semibold tracking-tight`.
- Descrição: `p` com `mt-1 text-sm text-muted-foreground`.
- Slot: `children ? <div className="mt-4 flex justify-center">…</div> : null` em ambos.

São byte-idênticos. Os dois call-sites na `CombosPage` (erro com botão "Tentar novamente"; vazio com CTA condicional a `canManageCatalog`) passam `titulo`, `descricao` e `children` da mesma forma — nenhum precisou ser reescrito. O estado vazio mantém o texto condicional por RBAC (`canManageCatalog`), preservando a diferença de copy entre quem pode e quem não pode gerenciar. AC-01.2 satisfeito por construção. (confirmed)

### Fronteiras

`StatePanel.tsx` compartilhado não aparece no stat do commit — está intocado. Nenhuma tabela, política, função de banco ou segredo no diff. A ADR é frontend puro e de apresentação; não há superfície de multi-tenant, RLS, RBAC, idempotência de webhook, segredo ou LGPD para avaliar aqui. O comentário de domínio da própria `CombosPage` ("a trava real é o RLS") permanece e continua verdadeiro. (confirmed)

### Contraprova

- `npm run typecheck` (`tsc -b`): sem erros — garante que não sobrou símbolo/import quebrado nem referência órfã a `React`.
- `npm run build` (`tsc -b && vite build`): concluiu em ~8,4s. O aviso de chunk > 500 kB (`index`, `TrendChart`) é pré-existente e não tem relação com esta refatoração de um import.
- `npm run test` (`vitest run`): 10 arquivos, 89 testes, todos verdes, incluindo `src/lib/segment-features.test.ts` (base de verdade do guard que a ADR-02 vai consumir). AC-01.3 satisfeito. (confirmed)

</details>

<details>
<summary>Arquivos alterados</summary>

- `src/app/config/combos/CombosPage.tsx` — adiciona import do `StatePanel` compartilhado; remove a função `StatePanel` local (~20 linhas) e o `import * as React` que só ela usava.

Diff completo: `git show 9a7fe9b`.

</details>
