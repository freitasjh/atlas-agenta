# ADR-15 — `/cadastro` lê e exibe a intenção de plano, com degradação segura

**Status:** proposto

## Contexto

Fechando o funil aberto por ADR-14: o `/cadastro` precisa **reconhecer** o plano que
veio de `/precos` via `?plano=<slug>` e exibi-lo em pt-BR, sem jamais persistir nada.
Hoje `CadastroPage` (em `src/auth/CadastroPage.tsx`) **não tem noção de plano**
(confirmado por leitura: form `tradeName`+`email`+`password`+`confirmPassword` via
`useForm`+`zodResolver(signupSchema)`+`useSignUp`; ao criar sessão navega `/app`; há
também o ramo "confirme seu e-mail" quando não há sessão). O comentário do arquivo já
diz "plano fica para fase posterior".

As travas negativas do PRD (RA-8, RA-9) e da análise de dados são **invioláveis**:
`signupSchema`, `useSignUp`, o trigger de signup (ADR-04, cria tenant em `trial`),
migrations e schema permanecem **byte-idênticos**. `?plano` é entrada do cliente **não
confiável** e **puramente apresentacional** — não alimenta `onSubmit`, nem query, nem
escrita. A validação é feita por `parsePlanSlug` (ADR-13), o único ponto de defesa.

## Decisão

Modificar `CadastroPage` em `src/auth/CadastroPage.tsx`:

1. **Ler a querystring** com `const [params] = useSearchParams()` (API idiomática do
   react-router; `useSearchParams` precisa ser adicionado ao import de
   `react-router-dom`, que já traz `Link`/`useNavigate`). Derivar o plano com função
   pura: `const plan = parsePlanSlug(params.get("plano"))` — **sem** `useState`, **sem**
   `useEffect` (estado derivado da URL).
2. **Bloco de plano escolhido (render condicional):** quando `plan` não é `null`,
   renderizar, **dentro do `CardContent`, antes do `<Form>`**, um bloco de destaque:
   container `rounded-md border border-primary/30 bg-primary/5 p-4`; uma pílula
   eyebrow jade "Plano escolhido"; um título `font-display font-semibold` **"Você
   escolheu o plano {getPlan(plan).nome}"**; e uma linha `muted` com um resumo curto
   dos destaques do plano. Associar por `aria-labelledby` (container → id do título)
   para leitura acessível; **não** usar `role="status"` (conteúdo presente no load,
   não atualização dinâmica).
3. **Ajuste leve de copy** na `CardDescription` do estado neutro: de "Comece o teste
   do Atlas Agenda." para **"Comece seu teste gratuito."** (alinha a voz; opcional,
   mas previsto no PRD). O texto não promete cobrança nem seleção definitiva.
4. **Degradação segura:** sem `?plano`, com valor vazio ou inválido (`?plano=xpto`),
   `parsePlanSlug` retorna `null`, o bloco **não renderiza**, e a tela fica no estado
   neutro — sem erro de console, sem travar o formulário. O valor cru **nunca** é
   interpolado no DOM; só o rótulo pt-BR obtido por `getPlan` é exibido (anti-XSS).
5. **Formulário intocado:** `useForm`, `zodResolver(signupSchema)`, `useSignUp`,
   `onSubmit` e o ramo "confirme seu e-mail" permanecem **idênticos**. O bloco de
   plano é render condicional isolado; **não** interage com `react-hook-form` e
   **não** entra em `onSubmit`. O fluxo nome/email/senha → `trial` → `/app` fica
   exatamente o mesmo.

Mobile-first, dark por padrão, TS estrito, sem `any`, sem dependência nova, sem
TanStack Query (não há dado de servidor novo).

## Consequências

- O funil marketing → `/precos` → `/cadastro` fica completo: a escolha do visitante é
  reconhecida visualmente, mas o tenant continua nascendo em `trial`.
- Nenhuma superfície de dados é aberta; a disciplina multi-tenant/RLS e o trigger de
  signup ficam intactos (diff vazio nas áreas de dados — RA-9).
- `src/lib/plans.ts` passa a ser consumido também por `auth`, confirmando o valor da
  fonte única.
- Prepara a UX da Fase 3 (seleção persistida/checkout) sem comprometer schema.

## Escopo

**frontend** (apresentacional; rota pública pré-login, sem guard, sem backend).

## Arquivos afetados

- **Modificar:** `src/auth/CadastroPage.tsx`.
- Consome: `src/lib/plans.ts` (`parsePlanSlug`, `getPlan`), `useSearchParams` do
  `react-router-dom`.
- **Não tocar (trava negativa):** `src/lib/validations/auth.ts` (`signupSchema`),
  `src/hooks/useAuthMutations.ts` (`useSignUp`), `supabase/migrations/**`,
  `supabase/functions/**`, schema/trigger.

## Critérios de aceite testáveis (desta ADR)

1. `/cadastro?plano=clinica` exibe, de forma acessível e em pt-BR, "Você escolheu o
   plano Clínica" com resumo curto dos destaques; idem para `individual` e `pro`.
2. `/cadastro` (sem `?plano`) e `/cadastro?plano=xpto` (inválido) **não** renderizam o
   bloco de plano, caem no estado neutro ("Comece seu teste gratuito"), **sem erro de
   console** e **sem travar** o formulário. O valor cru nunca aparece no DOM.
3. Concluir o cadastro (nome/e-mail/senha) **com e sem** `?plano` cria a conta em
   `trial` e navega para `/app` — comportamento idêntico ao atual; `onSubmit`/
   `useSignUp` não enviam plano.
4. Diff byte-idêntico em `signupSchema`, `useSignUp`, trigger ADR-04, migrations e
   schema; nenhuma migration nova.
5. Acessibilidade: o bloco é anunciável por leitor de tela (`aria-labelledby`
   coerente); foco visível preservado no formulário e no estado neutro.
6. `npm run build` + typecheck limpos; sem `any`; nenhuma dependência nova.

**Verificação:**
- `npm run build` (= `tsc -b && vite build`) passa limpo.
- `git diff --stat` e inspeção: confirmar que `src/lib/validations/auth.ts`,
  `src/hooks/useAuthMutations.ts` e `supabase/**` **não** aparecem no diff desta ADR.
- QA visual via Chrome DevTools (dev server `npm run dev`): abrir `/cadastro?plano=`
  para `clinica`/`individual`/`pro`, depois sem parâmetro e com `?plano=xpto`;
  conferir bloco presente/ausente, console limpo, e concluir um cadastro de teste
  para validar `trial` → `/app` sem regressão.

## Dependência

Depende de **ADR-13** (`parsePlanSlug`/`getPlan`). Independente da ADR-14 em código
(telas distintas), mas é a última do funil e fecha a jornada aberta por ela.
