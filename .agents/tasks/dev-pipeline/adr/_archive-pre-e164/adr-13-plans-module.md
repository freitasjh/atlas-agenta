# ADR-13 — Fonte única de verdade dos planos em `src/lib/plans.ts`

> Numeração: esta tarefa (landing/precos funcionais) começa em ADR-13 para não
> sobrescrever as ADRs 01–12 de tarefas anteriores que já vivem nesta pasta.
> No índice desta tarefa ela é a **primeira** (`current` inicial).

**Status:** proposto

## Contexto

A queixa do usuário (mensagens 10–12) é que `/precos` é uma vitrine morta: os três
cards não levam ao cadastro. O PRD aprovado e as análises decidiram a solução como
**puramente apresentacional** — o plano escolhido viaja ao `/cadastro` como intenção
visual via querystring `?plano=...`, sem nunca ser persistido (billing é Fase 3).

Hoje a lista de planos é um `const PLANOS` **local** dentro de
`src/marketing/pages.tsx` (confirmado por leitura: array com `nome`, `publico`,
`destaques`, sem `slug` nem flag de recomendado). Tanto `/precos` (gerar CTA com o
slug) quanto `/cadastro` (validar `?plano` e exibir o rótulo) precisam do **mesmo**
conjunto. Duplicar as strings entre `marketing` e `auth` é frágil; e `?plano` é a
**única superfície de entrada não confiável** da tarefa — precisa de um ponto único
de validação contra o enum conhecido `{individual, clinica, pro}`.

`src/lib/` já é o lar de módulos utilitários puros (`money.ts`, `phone.ts`,
`datetime.ts`, `scheduling-status.ts`). Um `plans.ts` aqui segue o padrão existente.

## Decisão

Criar `src/lib/plans.ts` como fonte única de verdade dos planos, exportando:

- `PLAN_SLUGS = ["individual", "clinica", "pro"] as const` e
  `type PlanSlug = (typeof PLAN_SLUGS)[number]`.
- `interface Plan { slug: PlanSlug; nome: string; publico: string;
  destaques: readonly string[]; recomendado?: boolean }`.
- `PLANS: readonly Plan[]` — na ordem **Individual → Clínica → Pro**, com
  `recomendado: true` **apenas** em `clinica`. Rótulos e destaques em pt-BR,
  reaproveitando o conteúdo já presente no `const PLANOS` de `pages.tsx` (slug na
  URL em ASCII: `clinica`; rótulo exibido com acento: `Clínica`).
- `parsePlanSlug(raw: string | null): PlanSlug | null` — faz `trim` + `lowercase`
  e checa pertencimento a `PLAN_SLUGS` (checagem tipada de literal union; retorna o
  slug ou `null`). Este é o ponto de validação de entrada externa da tarefa. **Não**
  usar zod aqui: é um `includes` tipado sobre um literal union, equivalente a
  `z.enum` mas mais simples e sem interpolar o valor cru.
- `getPlan(slug: PlanSlug): Plan` — lookup do `Plan` pelo slug.

**Decisão de fronteira (tipo):** `PlanSlug` **não** vai para `src/types/domain.ts`.
Aquele módulo é de enums de domínio **persistidos** (status de agendamento, roles de
RBAC). Plano de billing não é persistido nesta fase e é conceito de marketing;
mantê-lo em `src/lib/plans.ts` evita sugerir que a coluna `tenants.plan` já está em
uso. (A coluna existe no schema por `dominio.md`, mas esta ADR não a lê nem escreve.)

TypeScript estrito, **sem `any`**, **sem dependência nova**.

## Consequências

- `/precos` (ADR-14) e `/cadastro` (ADR-15) passam a importar de um único módulo; o
  `const PLANOS` local de `pages.tsx` será removido em ADR-14.
- `?plano` ganha um único validador reutilizável — a fronteira "entrada do cliente
  não confiável" fica contida em `parsePlanSlug`; o valor cru nunca é interpolado no
  DOM (previne XSS), só rótulos mapeados por lookup.
- Prepara a Fase 3: quando houver seleção persistida/checkout, `plans.ts` já é o
  ponto para mapear `slug → tenants.plan`. **Candidata a promoção futura para
  `docs/`** como decisão durável de modelagem de planos — anotar, não copiar agora.
- Risco ~nulo: módulo novo, puro, sem efeitos colaterais, sem backend.

## Escopo

**frontend** (somente um módulo utilitário puro; nenhum dado/backend).

## Arquivos afetados

- **Criar:** `src/lib/plans.ts`.
- Nenhuma mudança em `supabase/migrations/**`, `supabase/functions/**` ou
  `src/types/domain.ts`.

## Critérios de aceite testáveis (desta ADR)

1. `src/lib/plans.ts` existe e exporta `PLAN_SLUGS`, `PlanSlug`, `Plan`, `PLANS`,
   `parsePlanSlug`, `getPlan`.
2. `PLANS` tem exatamente 3 itens na ordem Individual, Clínica, Pro; só `clinica`
   tem `recomendado: true`; rótulos/destaques em pt-BR.
3. `parsePlanSlug` retorna o slug para `"individual" | "clinica" | "pro"` (inclusive
   com espaços/maiúsculas, ex.: `" Clinica "` → `"clinica"`) e `null` para `null`,
   `""`, `"xpto"` ou qualquer valor fora do enum.
4. `npm run typecheck` passa limpo; nenhum `any`; nenhuma dependência nova em
   `package.json`/lockfile.

**Verificação:** rodar `npm run typecheck` (= `tsc -b`) e confirmar saída limpa.
Como ainda não há suíte de testes no projeto, a verificação de comportamento de
`parsePlanSlug` é feita por typecheck + inspeção; os critérios 1–3 são re-exercidos
de ponta a ponta no QA das ADR-14/15 (navegação real com `?plano` válido/ inválido).

## Dependência

Primeira ADR desta tarefa. Não depende de nenhuma ADR anterior desta tarefa; apenas
reaproveita o conteúdo textual do `const PLANOS` já existente em `pages.tsx`.
