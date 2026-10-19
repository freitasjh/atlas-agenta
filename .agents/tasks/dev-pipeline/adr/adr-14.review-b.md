# Revisão B — ADR-14: `/precos` acionável (CTA por plano + destaque do recomendado)

CTAs por plano adicionados a `PrecosPage` (`src/marketing/pages.tsx`): cada card ganha
`Button asChild` + `Link to={/cadastro?plano=${slug}}`, variante `default` só no plano
recomendado (Clínica) e `outline` nos demais, com selo textual "Recomendado" e borda de
acento jade. O `const PLANOS` local foi removido e a página passou a consumir `PLANS` de
`src/lib/plans.ts` (ADR-13). Diff mínimo, só `PrecosPage`, só apresentação.

**Watch for:** nada bloqueante. Um refinamento fora da letra da ADR (`mt-auto` no CTA) e
dois itens de contraste/console que são explicitamente delegados ao QA. (confirmado)

**Verdict**: APPROVED

## High-level view

A mudança bate com a decisão da ADR linha a linha: fonte única `PLANS`, CTA real via
`Button asChild` + `Link` (nenhum `<a>` cru nem `onClick` em `div`), destaque do Clínica
por cor/borda/selo sem reordenar nem usar `scale`, e nenhum valor monetário fabricado — o
aviso "valores … em breve" permanece no cabeçalho.

Fronteiras do projeto: a ADR é 100% apresentacional e o diff confirma isso. Nenhuma tabela,
política RLS, Edge Function, segredo, env var ou migration é tocada. Multi-tenant, RBAC e
idempotência não se aplicam a esta superfície pública pré-login; não há regressão de
isolamento a avaliar. O único vetor de entrada não confiável (`?plano`) é produzido aqui
como string literal controlada (`plano.slug`, um `PlanSlug` do catálogo) e será validado no
consumo pela ADR-15 via `parsePlanSlug` — nada a interpolar de fonte externa nesta ADR.

Design doc React: `Button asChild` renderiza `<a href>` real com foco visível herdado
(`focus-visible:ring-2` do `buttonVariants`), acessível por `Tab`/`Enter`; selo é texto
("Recomendado"), não só cor (WCAG 1.4.1); mobile-first com `w-full` e `sm:grid-cols-3` já
presentes. TS estrito, sem `any`, sem dependência nova. `npm run build` passa limpo.

<details>
<summary>Issues (2)</summary>

1. **`mt-auto` não previsto na ADR** — o CTA usa `className="mt-auto w-full"`; a ADR
   especificava apenas `w-full`. É um acréscimo benigno (empurra o botão para a base do
   card, alinhando os CTAs quando os `destaques` têm alturas diferentes) e coerente com o
   `flex flex-col` do card. Não bloqueia; registrar só como desvio consciente da letra.
2. **Contraste do selo e console limpo → QA** — o par `text-primary` sobre `bg-primary/10`
   (estimado ~5:1 pela análise) e o console sem erro/warn em `/precos` não são verificáveis
   por build; ficam para o QA visual (step seguinte), conforme o próprio critério da ADR.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR — ponto a ponto

Confrontei a seção "Decisão" da ADR com o commit `1b89994` (único commit do escopo; `git
show --stat` confirma só `src/marketing/pages.tsx`, +31/-40):

1. **Consumir `PLANS` e remover `const PLANOS`** — feito. Import `import { PLANS } from
   "@/lib/plans"` presente; o bloco `const PLANOS … as const` foi removido. (confirmado)
2. **CTA por plano** — `Button asChild` envolve `Link to={/cadastro?plano=${plano.slug}}`,
   texto "Começar com o {plano.nome}", `variant={plano.recomendado ? "default" :
   "outline"}`, `w-full`. Nenhum `<a>` cru nem `onClick` em `div` (RA-3). (confirmado)
3. **Destaque do recomendado** — `border-primary` no card recomendado (ternário sobre
   `border-border`), selo pílula `rounded-full border border-primary/30 bg-primary/10
   px-2.5 py-0.5 text-xs font-medium text-primary` com o texto "Recomendado". Ordem
   Individual → Clínica → Pro mantida (vem de `PLANS`), sem `scale`/elevação. `StatusBadge`
   **não** foi reusado para o selo, como a ADR exige — e segue em uso só na `LandingPage`,
   então não virou import órfão. (confirmado)
4. **Copy honesta de preço** — o cabeçalho de `PrecosPage` mantém "Valores e contratação
   chegam em breve"; nenhum número fabricado foi introduzido. (confirmado)
5. **Opcional: migrar para `Card` do shadcn** — não feito; a ADR marca como opcional e pede
   priorizar o diff mínimo. (confirmado)

Único desvio da letra: `mt-auto` além do `w-full` (ver Issues #1). Benigno.

### Fronteiras (multi-tenant / RLS / RBAC / idempotência / segredos / LGPD)

O diff não cruza nenhuma fronteira sensível, e isso é verificável pelo escopo: um só
arquivo de apresentação em `src/marketing`, rota pública pré-login. Confirmei que não há
import de cliente Supabase, `service role`, env var, token, nem chamada de rede no trecho
alterado — o único efeito é navegação client-side por `Link`. `?plano` sai daqui como
`plano.slug` (literal do catálogo `PLANS`, tipado `PlanSlug`), não como dado de usuário;
a validação de entrada não confiável acontece no consumo (ADR-15/`parsePlanSlug`). Nenhuma
regra de LGPD, consentimento ou PII é tocada. (confirmado)

### Contraprova de build

`npm run build` (`tsc -b && vite build`) terminou com exit 0, sem erro de tipo e sem `any`
implícito. Não há script de lint/test no `package.json` (só `dev`/`build`/`typecheck`/
`preview`), então a contraprova disponível é o build — que passou. Nenhuma dependência nova
em `package.json` (confirmado contra o arquivo). O aviso de chunk > 500 kB é pré-existente e
diz respeito ao bundle inteiro, não a este diff. (confirmado)

</details>

<details>
<summary>Arquivos no escopo</summary>

- `src/marketing/pages.tsx` — `PrecosPage` passa a mapear `PLANS` e renderizar CTA + selo;
  `const PLANOS` local removido. `LandingPage`, `Feature` e `TermosPage` inalterados.

Diff completo: `git show 1b89994`.
</details>
