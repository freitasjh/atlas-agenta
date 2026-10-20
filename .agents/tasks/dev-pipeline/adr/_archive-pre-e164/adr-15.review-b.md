# ADR-15 — `/cadastro` lê e exibe a intenção de plano — Parecer Revisor B

Exibição apresentacional da intenção de plano no `/cadastro`. O commit `f206a35`
toca **um único arquivo** (`src/auth/CadastroPage.tsx`, +27/-2): adiciona
`useSearchParams`, deriva `plan = parsePlanSlug(params.get("plano"))` como estado
puro da URL, e renderiza um bloco condicional de destaque dentro do `CardContent`
antes do `<Form>`. O `onSubmit`, o `signupSchema`, o `useSignUp`, o ramo "confirme
seu e-mail" e as migrations ficam intocados. A disciplina multi-tenant/RLS/trigger
de signup não é tocada (diff vazio nas áreas de dados).

Watch for: nenhuma objeção bloqueante — uma divergência cosmética de cor da pílula
eyebrow em relação à ADR (QA-visual), sem impacto funcional.

**Verdict**: APPROVED

## Visão de alto nível

A entrada `?plano` é a única superfície não confiável e é validada no ponto único
`parsePlanSlug`, que faz `trim`+`lowercase` e checa pertencimento ao enum; valor
inválido/vazio/ausente retorna `null` e o bloco simplesmente não renderiza
(degradação segura, sem erro de console, formulário intacto). O valor cru nunca é
interpolado no DOM — só o rótulo pt-BR obtido por `getPlan(plan).nome` e os
`destaques`, o que fecha a porta de XSS por querystring.

O plano é derivado da URL sem `useState`/`useEffect`, como manda a ADR, e não entra
em `onSubmit` nem em nenhuma query/escrita. O tenant continua nascendo em `trial`:
`onSubmit` passa só `values` do form para `signUp.mutateAsync`, sem qualquer campo de
plano. As travas negativas (RA-8/RA-9) foram confirmadas byte-idênticas por diff
contra o ponto pré-funil (`57b4669`): `signupSchema`, `useSignUp` e `supabase/**` não
aparecem.

Build limpo (`tsc -b && vite build`). Não há lint/test no projeto (scripts: `dev`,
`build`, `typecheck`, `preview`), então a contraprova é o build + typecheck, ambos
verdes. O aviso de chunk > 500 kB é pré-existente e não tem relação com este diff de
27 linhas.

<details>
<summary>Issues (1)</summary>

1. **Cor da pílula eyebrow diverge da ADR (cosmético)** — a ADR pede "pílula eyebrow
   jade"; a pílula "Plano escolhido" usa `bg-primary/10 text-foreground`, enquanto a
   pílula de plano recomendado do `/precos` (ADR-14) usa `text-primary` + borda
   `border-primary/30`. Jade = `primary` neste design, então o fundo está coerente,
   mas o texto não acompanha a cor jade. Alinhar para `text-primary` (e,
   opcionalmente, a borda) daria consistência visual entre as duas pílulas do funil.
   Não-bloqueante; decisão fina do QA visual.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR

Confronto item a item da seção Decisão:

1. **Ler a querystring** — `const [params] = useSearchParams()` adicionado ao import
   de `react-router-dom` (que já trazia `Link`/`useNavigate`). `plan` derivado por
   função pura, **sem** `useState`/`useEffect`. ✔
2. **Bloco de plano** — render condicional `{plan ? (...) : null}` dentro do
   `CardContent`, antes do `<Form>`; container
   `rounded-md border border-primary/30 bg-primary/5 p-4` (a ADR não exigia `mb-4`; o
   código adiciona `mb-4`, consistente com o espaçamento do bloco de erro abaixo);
   pílula eyebrow "Plano escolhido"; título `font-display font-semibold` "Você
   escolheu o plano {nome}"; linha `muted` com `destaques.join(" · ")`. ✔ (ressalva
   cosmética da cor na lista de Issues).
3. **Copy da `CardDescription`** — "Comece seu teste gratuito." ✔
4. **Degradação segura** — `parsePlanSlug` cobre `null` (sem param), `""`
   (`?plano=`) e `?plano=xpto` → todos retornam `null` → bloco não renderiza, estado
   neutro, sem travar o form. Confirmado por leitura de `plans.ts`. ✔
5. **Formulário intocado** — `useForm`/`zodResolver(signupSchema)`/`useSignUp`/
   `onSubmit` e o ramo `checkEmail` idênticos. O bloco de plano não referencia
   `form`, não aparece em `onSubmit`. ✔

### Fronteiras de segurança

- **Dados não confiáveis / anti-XSS:** `?plano` passa por `parsePlanSlug` (ponto
  único de validação contra `PLAN_SLUGS`). A UI exibe só `getPlan(plan).nome` e
  `destaques` — strings do catálogo estático, nunca o valor cru. React escapa texto
  por padrão e nenhum `dangerouslySetInnerHTML` é usado. Porta de XSS fechada.
- **Multi-tenant / RLS / trigger de signup:** diff vazio em `supabase/**`,
  `signupSchema` e `useSignUp`. Verificado com
  `git diff 57b4669 HEAD -- src/lib/validations/auth.ts src/hooks/useAuthMutations.ts supabase/`
  → saída vazia. O tenant nasce em `trial`; plano não é persistido (consistente com o
  escopo de marketing da Fase 1, billing/checkout é Fase 3).
- **RBAC / segredos / LGPD:** rota pública pré-login, sem dado de servidor novo, sem
  segredo, sem PII logada. N/A acionável.
- **`getPlan` com cast `as Plan`:** o `find` é garantido porque o argumento é um
  `PlanSlug` já validado e `PLANS` cobre todo o enum — tipagem estrita preservada,
  sem `any`.

### Design doc React

Componente funcional, TS estrito, sem `any`, sem dependência nova, sem TanStack Query
(não há dado de servidor). Estado derivado da URL em vez de espelhado em `useState`
— padrão correto do React Router. Acessibilidade: `aria-labelledby` aponta para o id
do título (`plano-escolhido-titulo`), sem `role="status"` (conteúdo presente no load,
não atualização dinâmica — decisão correta). Foco visível do formulário e do estado
neutro preservados. Mobile-first mantido (sem breakpoints novos conflitantes).

### Contraprova

- `npm run build` (`tsc -b && vite build`): **passou** (`✓ built in 5.57s`), sem erro
  de type.
- Sem suíte de lint/test no `package.json`; `typecheck` está embutido no `build`
  (`tsc -b`).
- Aviso de chunk > 500 kB é pré-existente (bundle monolítico do app), não introduzido
  por este diff.

</details>

<details>
<summary>Arquivos alterados</summary>

- `src/auth/CadastroPage.tsx` — import de `useSearchParams` e de `getPlan`/
  `parsePlanSlug`; derivação de `plan` a partir de `?plano`; bloco condicional de
  "Plano escolhido"; ajuste de copy da `CardDescription`.

Diff completo: `git show f206a35 -- src/`.

</details>
