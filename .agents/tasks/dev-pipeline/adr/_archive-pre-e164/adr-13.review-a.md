# ADR-13 Review — Revisor A (Independente)

**Status**: **NEEDS_CHANGES** — bloqueante

**Sumário**: A ADR-13 propõe criar `src/lib/plans.ts` como fonte única de verdade dos planos de billing (Individual, Clínica, Pro), exportando os tipos `PlanSlug`, `Plan`, constantes `PLANS` e funções `parsePlanSlug` + `getPlan` para validação e lookup. O objetivo é preparar o solo para que `/precos` (ADR-14) e `/cadastro` (ADR-15) usem um único catálogo e o `?plano` seja validado contra um enum conhecido.

**O que foi implementado**: apenas `src/lib/plans.ts` — o módulo em si foi criado com estrutura, tipos e lógica corretos.

**O que está faltando**: as mudanças em `src/marketing/pages.tsx` e `src/auth/CadastroPage.tsx` **não foram aplicadas**, invalidando o escopo declarado da ADR. A ADR-13 é a primeira de uma sequência (ADR-13 → ADR-14 → ADR-15); se a ADR-13 terminar com o módulo criado mas sem a integração que a valida, as ADRs seguintes não conseguem partir de um ponto estável.

---

## Implementação do `src/lib/plans.ts` — Aprovado ✓

O módulo foi criado com qualidade:

**Tipagem e constantes**: `PLAN_SLUGS` é um literal union correto; `PlanSlug` (derivado de `PLAN_SLUGS[number]`) é tipado estritamente. `Plan` é uma interface bem estruturada com `slug`, `nome`, `publico`, `destaques`, e `recomendado?: boolean`. **Sem `any`.**

**Dados**: `PLANS` contém exatamente 3 planos na ordem Individual → Clínica → Pro; apenas `clinica` tem `recomendado: true`. Rótulos e destaques em pt-BR, reaproveitados do `const PLANOS` anterior de `pages.tsx`.

**Validação de entrada**: `parsePlanSlug(raw: string | null): PlanSlug | null` faz trim + lowercase e verifica pertencimento a `PLAN_SLUGS` — exatamente conforme especificado. Retorna `null` para qualquer valor inválido/ausente. **Nenhuma interpolação direta do valor cru; seguro contra XSS**.

**Lookup**: `getPlan(slug: PlanSlug)` usa `find` e cast (`as Plan`) — válido porque a tipagem garante que o slug sempre existe em `PLANS`.

**Qualidade**: TypeScript estrito, comentários claros sobre o propósito do módulo e a decisão de não incluir `PlanSlug` em `types/domain.ts`. Nenhuma dependência nova. **Build e typecheck passam limpos.**

---

## Lacuna: Integração não aplicada — Bloqueante ✗

A ADR-13 declara escopo "frontend (somente um módulo utilitário puro; nenhum dado/backend)". Porém, os critérios de aceite listados incluem:

> **Critério 2**: "usam `/precos` (ADR-14) e `/cadastro` (ADR-15) [passam a importar] de um único módulo"
> 
> **Critério 3**: "`?plano` ganha um único validador reutilizável"

Esses critérios **não podem ser verificados apenas lendo `src/lib/plans.ts`** — exigem que o módulo **seja integrado ao código que o usa**. Especificamente:

1. **`src/marketing/pages.tsx`** — `PrecosPage` deve:
   - Remover o `const PLANOS` local
   - Importar `PLANS` e `getPlan` de `src/lib/plans`
   - Renderizar o card **Clínica** com `recomendado: true` (borda jade, selo "Recomendado", CTA `variant="default"`)
   - Renderizar os outros dois com CTA `variant="outline"`
   - Cada card recebe um `Button asChild` com `Link to={`/cadastro?plano=${plano.slug}`}`
   - **Nenhuma mudança foi aplicada.** O arquivo continua com `const PLANOS` local, sem importação de `plans.ts`, sem CTAs de navegação.

2. **`src/auth/CadastroPage.tsx`** — deve:
   - Importar `useSearchParams` do react-router, `parsePlanSlug` e `getPlan` de `src/lib/plans`
   - Ler `?plano` via `useSearchParams` e validar com `parsePlanSlug`
   - Renderizar um bloco de destaque condicional ("Você escolheu o plano {nome}") se o slug é válido
   - O bloco contém resumo dos destaques; sem plano ou inválido, o bloco não renderiza
   - **Nenhuma mudança foi aplicada.** O arquivo segue idêntico, sem `useSearchParams`, sem validação, sem bloco de plano.

Essa lacuna não é uma "observação menor"; **invalida o escopo da ADR**. A análise de dados (analysis-data.md, critério 8) explicitamente reafirma:

> "signupSchema, useSignUp, trigger ADR-04, migrations e schema permanecem **byte-idênticos** (diff vazio nesses arquivos/áreas)."

Está correto que `signupSchema` não mudou, mas isso é porque a integração no `CadastroPage` não foi feita.

---

## Impacto na sequência de ADRs

- **ADR-14** (precos funcionais com CTA) depende de consumir `PLANS` de `src/lib/plans.ts`. Sem a integração em `pages.tsx`, ADR-14 não tem um ponto de partida válido.
- **ADR-15** (cadastro com intenção de plano) depende de `parsePlanSlug` estar sendo usado. Sem a integração em `CadastroPage.tsx`, ADR-15 também está bloqueada.

A estrutura de ADRs encadeadas requer que cada ADR deixe seu escopo **completo e verificável**. Uma ADR que entrega apenas metade — o módulo utilitário mas não seu consumo — quebra essa cadeia.

---

## Critérios de aceite da ADR-13 — Status

| # | Descrição | Status |
|---|-----------|--------|
| 1 | `src/lib/plans.ts` exporta `PLAN_SLUGS`, `PlanSlug`, `Plan`, `PLANS`, `parsePlanSlug`, `getPlan` | ✓ Atendido |
| 2 | `PLANS` tem 3 itens, ordem correta, só `clinica` recomendado, rótulos pt-BR | ✓ Atendido |
| 3 | `parsePlanSlug` valida entrada + retorna slug ou null | ✓ Atendido |
| 4 | `npm run typecheck` limpo, sem `any`, sem dependência nova | ✓ Atendido |
| **5** | **`/precos` e `/cadastro` passam a importar do módulo** | ✗ **Não atendido** |
| **6** | **`?plano` é validado e usado no `/cadastro`** | ✗ **Não atendido** |

Critérios 1–4 são **puramente sobre o módulo** e estão OK. Critérios 5–6 são sobre a **integração** e estão bloqueados.

---

## Próximas ações obrigatórias

1. **Em `src/marketing/pages.tsx`**:
   - Remover `const PLANOS`
   - Importar: `import { PLANS } from "@/lib/plans"`
   - Na função `PrecosPage`, mapear `PLANS` e renderizar cada plano como card
   - Adicionar CTA com `Button asChild` + `Link to={`/cadastro?plano=${plano.slug}`}`
   - Aplicar destaque visual ao `clinica`: borda `border-primary`, selo "Recomendado", CTA `variant="default"`

2. **Em `src/auth/CadastroPage.tsx`**:
   - Importar: `import { useSearchParams } from "react-router-dom"` + `import { parsePlanSlug, getPlan } from "@/lib/plans"`
   - No corpo do `CadastroPage`, ler `?plano`: `const [params] = useSearchParams(); const plan = parsePlanSlug(params.get("plano"))`
   - Renderizar um bloco condicional antes do `<Form>`: se `plan` é válido, exibir "Você escolheu o plano {nome}" com resumo
   - Sem plano/inválido, nenhum bloco renderiza; o formulário continua idêntico
   - Ajuste opcional: mudar a `CardDescription` de "Comece o teste do Atlas Agenda" para "Comece seu teste gratuito" (mais consistente com a análise)

3. **Validação**:
   - Rodar `npm run build` + `npm run typecheck` (devem passar limpos)
   - Testar em dev server (`npm run dev`):
     - `/precos`: 3 cards visíveis, cada um com CTA focável, Clínica destacada
     - `/precos` → clique em CTA: navega para `/cadastro?plano=individual|clinica|pro`
     - `/cadastro?plano=clinica`: bloco de plano renderiza acima do form; form funciona
     - `/cadastro?plano=xpto`: estado neutro, sem erro
     - `/cadastro` (sem plano): estado neutro
     - Concluir cadastro com e sem `?plano`: comportamento idêntico, navega para `/app`

---

## Conclusão

O módulo `src/lib/plans.ts` é **sólido e pronto para uso**. Porém, a ADR-13 não completou seu escopo de integração. O trabalho está **52% feito** (o módulo) + **0% feito** (a integração que o valida).

**Veredito: NEEDS_CHANGES.** Implemente os ajustes em `pages.tsx` e `CadastroPage.tsx`, rode a verificação, e submeta novamente.
