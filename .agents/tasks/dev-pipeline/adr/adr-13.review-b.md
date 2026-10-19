# Review B — ADR-13: fonte única de verdade dos planos (`src/lib/plans.ts`)

Revisor independente B. Escopo revisado: commit `ac804eb`
("feat: add single source of truth for plans in src/lib/plans.ts"), que cria
**apenas** `src/lib/plans.ts` (93 linhas, +93/−0). Nenhum outro arquivo de
aplicação, migration, Edge Function, `package.json` ou lockfile foi tocado.

Novo módulo apresentacional e puro: exporta `PLAN_SLUGS`, `PlanSlug`, `Plan`,
`PLANS`, `parsePlanSlug`, `getPlan`. O plano é intenção visual de marketing —
não é persistido, não alimenta query/escrita, não lê `tenants.plan`. A tarefa
ainda não consome o módulo (consumo é ADR-14/15), o que é correto para uma ADR
module-only.

Watch for:
- `getPlan` usa `as Plan` para afirmar totalidade de `Array.find` — seguro hoje,
  mas é um ponto frágil se o enum e o catálogo divergirem no futuro (possible).
- Nenhuma fronteira de segurança é cruzada nesta ADR: sem backend, sem RLS, sem
  RBAC, sem segredos, sem PII. `parsePlanSlug` é a única superfície de entrada
  não confiável e está corretamente contida (confirmed).

**Verdict**: APPROVED

## High-level view

A decisão central da ADR — extrair os planos de um `const PLANOS` local em
`pages.tsx` para um módulo puro em `src/lib/` — está implementada fielmente. O
conteúdo textual (nomes, público, destaques) bate 1:1 com o `const PLANOS`
original, a ordem Individual → Clínica → Pro é respeitada e só `clinica` tem
`recomendado: true`. Os quatro critérios de aceite da ADR estão satisfeitos.

A fronteira que importa nesta tarefa é "entrada do cliente não confiável":
`parsePlanSlug` normaliza (`trim` + `lowercase`) e valida por pertencimento ao
literal union, devolvendo `PlanSlug | null`. O valor cru nunca é interpolado nem
exposto — a UI (ADR-14/15) usará só o slug validado para lookup. Isso previne o
vetor de XSS que a ADR cita, e o padrão é equivalente a um `z.enum` sem a
dependência; dado que é um `includes` tipado sobre union literal, não usar zod
aqui é defensável e consistente com a justificativa da ADR.

A decisão de fronteira de tipo (`PlanSlug` fora de `src/types/domain.ts`) foi
respeitada: o módulo não importa nem toca `domain.ts`, evitando sugerir que a
coluna `tenants.plan` já está em uso. O estilo e o nível de documentação seguem
o padrão dos utilitários puros vizinhos (`scheduling-status.ts`, `money.ts`).

Contraprova verde: `npm run typecheck` (`tsc -b`) e `npm run build` passam limpos,
sem `any`, sem dependência nova. O projeto não tem lint/format configurado — os
únicos scripts de qualidade são `typecheck` e `build`, ambos executados.

<details>
<summary>Issues (2)</summary>

1. **`getPlan` com `as Plan` assume totalidade** — `PLANS.find(...) as Plan`
   mascara o `undefined` do `find`. Hoje é seguro (o slug é um `PlanSlug`
   validado e `PLANS` cobre o enum), mas se um slug for adicionado a
   `PLAN_SLUGS` sem entrada correspondente em `PLANS`, o cast esconde o bug em
   runtime (`undefined`) em vez de falhar no typecheck. Não-bloqueante; opcional
   endurecer (ver detalhe). (possible)
2. **Comportamento de `parsePlanSlug` não coberto por teste automatizado** — a
   ADR reconhece que não há suíte e delega a verificação de ponta a ponta ao QA
   das ADR-14/15. Aceitável pela convenção do projeto ("não adicionar testes sem
   pedido"); registrado apenas como lacuna consciente. (confirmed)

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e aos critérios de aceite

Os quatro critérios testáveis da ADR foram conferidos contra o código:

1. **Exports** — `PLAN_SLUGS`, `PlanSlug`, `Plan`, `PLANS`, `parsePlanSlug`,
   `getPlan` estão todos presentes e exportados. ✔ (confirmed)
2. **`PLANS` com 3 itens, ordem e recomendado** — exatamente três entradas na
   ordem Individual → Clínica → Pro; `recomendado: true` só em `clinica`;
   rótulos e destaques em pt-BR. ✔ (confirmed)
3. **`parsePlanSlug` robusto** — `trim().toLowerCase()` antes da checagem cobre
   `" Clinica "` → `"clinica"`; `null`, `""`, `"xpto"` e qualquer valor fora do
   enum retornam `null`. ✔ (confirmed, por inspeção)
4. **Typecheck limpo, sem `any`, sem dep nova** — `tsc -b` verde; grep do módulo
   não encontra `any`; o commit não altera `package.json`/lockfile. ✔ (confirmed)

Fidelidade de conteúdo: comparei o `PLANS` novo com o `const PLANOS` ainda
presente em `src/marketing/pages.tsx` (a remoção dele é escopo da ADR-14, não
desta). Nomes, `publico` e `destaques` batem palavra por palavra nos três
planos. O módulo acrescenta `slug` (ASCII, `clinica` sem acento) e
`recomendado`, exatamente como a ADR especifica. (confirmed)

### Fronteira de entrada não confiável — `parsePlanSlug`

Único ponto sensível da ADR:

```ts
export function parsePlanSlug(raw: string | null): PlanSlug | null {
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  return (PLAN_SLUGS as readonly string[]).includes(normalized)
    ? (normalized as PlanSlug)
    : null;
}
```

O `as readonly string[]` é o idioma correto para contornar a assinatura estreita
de `.includes` sobre um tuple de literais — não é supressão de erro real nem
`any`. O `as PlanSlug` ocorre só dentro do ramo já guardado pelo `includes`, ou
seja, é narrowing seguro. A função devolve sempre `PlanSlug | null`, nunca o
valor cru; combinada com o `getPlan` por lookup, garante que a UI jamais
interpole a string de entrada no DOM. Esse é o contrato que fecha o vetor de XSS
mencionado na ADR. (confirmed)

Assinatura `raw: string | null` casa com `URLSearchParams.get()`, que o
`CadastroPage` usará na ADR-15 — a fronteira já está tipada para o consumidor.

### `getPlan` e o `as Plan`

```ts
export function getPlan(slug: PlanSlug): Plan {
  return PLANS.find((plan) => plan.slug === slug) as Plan;
}
```

`Array.prototype.find` tem tipo de retorno `Plan | undefined`; o `as Plan`
afirma que sempre acha — verdadeiro **hoje** porque `PLANS` cobre os três slugs
e o argumento é um `PlanSlug` validado (o comentário no código documenta esse
raciocínio).

A fragilidade é de manutenção, não de runtime atual: se alguém adicionar um slug
a `PLAN_SLUGS` e esquecer a entrada em `PLANS`, o typecheck continua verde e
`getPlan` passa a devolver `undefined` tipado como `Plan` — um erro que só
aparece em runtime no consumidor. Não é bloqueante (a ADR é module-only e o
catálogo é estático), mas há duas formas baratas de deixar o compilador vigiar a
cobertura, caso o pipeline queira endurecer em ADR futura:

- lançar explicitamente em vez de castar (`if (!plan) throw ...`), trocando o
  `undefined` silencioso por falha ruidosa; ou
- tipar `PLANS` como `Record<PlanSlug, Plan>` (ou derivar o catálogo de um
  objeto indexado por slug), fazendo o typecheck exigir cobertura total do enum.

Deixo como observação acionável opcional, não como condição de aprovação.
(possible)

### Fronteiras multi-tenant / RLS / RBAC / idempotência / segredos / LGPD

Nenhuma é cruzada nesta ADR, e isso foi verificado, não assumido:

- **Multi-tenant / RLS**: o módulo não lê nem escreve tabela alguma, não
  referencia `tenant_id`, não cria política. Nenhum arquivo em
  `supabase/migrations/**` ou `supabase/functions/**` no diff. ✔
- **RBAC**: rotas afetadas (futuras) são públicas pré-login; o módulo não tem
  noção de papel. ✔
- **Idempotência**: não há webhook nem efeito colateral — N/A. ✔
- **Segredos**: nenhuma chave, nenhum `.env`, nada de service role. ✔
- **LGPD**: nenhum dado de cliente final, nenhum telefone/documento, nenhum
  `whatsapp_opt_in`. O "plano" é marketing, não PII. ✔

A decisão de **não** colocar `PlanSlug` em `src/types/domain.ts` foi cumprida —
confirmei por grep que `plans.ts` não importa `domain.ts` e `domain.ts` não foi
tocado. Isso preserva a semântica de que `domain.ts` é só para enums persistidos
e evita sinalizar uso prematuro da coluna `tenants.plan`. (confirmed)

### Aderência ao design doc React

A ADR-13 é só o módulo utilitário; não há componente, rota, hook ou formulário
aqui, então a maior parte do design doc (CTAs, selo, acessibilidade, contraste)
é escopo de ADR-14/15. O que o design doc especifica para **este** módulo —
`PLAN_SLUGS`/`PlanSlug`/`Plan`/`PLANS`/`parsePlanSlug`/`getPlan`, sem zod, sem
dep nova, slug `clinica` ASCII vs rótulo `Clínica`, `recomendado` só no clínica,
tipo fora de `domain.ts` — está implementado exatamente como descrito. O estilo
(função pura, JSDoc, `as const`) segue os vizinhos de `src/lib/`. (confirmed)

### Contraprova

- `npm run typecheck` (`tsc -b`) → saída limpa, exit 0.
- `npm run build` (`tsc -b && vite build`) → build concluído, exit 0. O aviso de
  chunk > 500 kB é pré-existente (bundle único do app) e não tem relação com
  este módulo de 93 linhas.
- Sem script de lint/format no `package.json`; os dois scripts de qualidade
  existentes foram rodados.
- `package.json` e lockfile inalterados no commit. (confirmed)

</details>

<details>
<summary>Arquivos no escopo</summary>

- `src/lib/plans.ts` (novo, +93) — fonte única dos planos: `PLAN_SLUGS`,
  `PlanSlug`, `Plan`, `PLANS`, `parsePlanSlug`, `getPlan`. Puro, sem efeito
  colateral, sem backend.

Diff completo: `git show ac804eb`.

</details>
