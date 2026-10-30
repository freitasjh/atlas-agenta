# Análise de Dados e Segurança — Marketing/Auth maduro (landing, preços, login)

> Papel: ANALISADOR DE DADOS E SEGURANÇA do dev-pipeline.
> Artefato: requisitos verificáveis, critérios de aceite testáveis, modelo de
> dados/migrations e enquadramento no roadmap, **sob a ótica de dados/segurança**.
> Não escreve código de aplicação.

## Veredito de dados/segurança: demanda SEM superfície de dados

**Esta demanda NÃO toca banco de dados, Supabase, RLS, Auth, Edge Functions,
migrations nem schema.** É melhoria de UI 100% pública/estática no frontend
(landing, `/precos`, header de marketing e painel esquerdo do `AuthLayout`).

Confirmado por inspeção dos arquivos-alvo:

- `src/lib/plans.ts` — catálogo apresentacional em memória. O próprio arquivo
  documenta (ADR-13) que **plano é conceito de marketing nesta fase**: não é
  persistido, não alimenta query nem escrita, o tenant nasce em `trial`, e
  billing/checkout + uso efetivo de `tenants.plan` são **Fase 3**.
- `src/marketing/pages.tsx`, `src/marketing/MarketingLayout.tsx`,
  `src/auth/AuthLayout.tsx` — componentes de apresentação. Não importam o cliente
  Supabase, não usam TanStack Query, não leem/escrevem dados de domínio.

### Consequências para este documento

- **Modelo de dados: N/A.** Nenhuma tabela nova, nenhuma coluna nova, nenhum tipo
  de domínio novo. `price_cents` adicionado a `src/lib/plans.ts` é uma **constante
  TypeScript de marketing**, não uma coluna de banco — segue a convenção de nome
  `*_cents` (inteiro) por consistência conceitual, mas vive em código, não em
  Postgres.
- **Migrations: NENHUMA.** Não criar, não editar, não tocar `supabase/migrations`.
  Reescrever a análise só para "ter uma migration" seria defeito. Qualquer ADR do
  planejador que proponha migration para esta demanda está errada.
- **RLS / RBAC / políticas: N/A.** Não há tabela de domínio envolvida, logo nada a
  habilitar ou escrever. As fronteiras invioláveis de RLS/RBAC continuam válidas no
  projeto, mas **nenhuma delas é exercida por esta tarefa** — não há leitura de
  `charges`, nem de `appointments`, nem derivação de `tenant_id`.

As fronteiras invioláveis listadas no prompt (RLS em toda tabela de domínio;
`tenant_id` do JWT/profiles e nunca do cliente; cross-tenant só por Edge Function
service role / policy `super_admin` auditada; RBAC admin/professional/receptionist
com recepção sem `charges`; `no_overlap` por `tstzrange`; webhooks idempotentes e
autenticados; segredos só em Edge Functions/env) **permanecem verdadeiras e não são
violadas nem relaxadas** por esta demanda, simplesmente porque ela não cruza a
camada de dados. Registrado para rastreabilidade, não porque haja algo a mudar.

## A ÚNICA superfície de segurança desta tarefa: entrada não confiável `?plano`

Embora não haja dados, há **uma** preocupação de segurança frontend legítima, e ela
é inegociável:

- `?plano=<slug>` na URL de `/cadastro` é entrada **controlada pelo usuário / não
  confiável**. `parsePlanSlug` (em `src/lib/plans.ts`) é o **ponto único de
  validação** contra o enum `PLAN_SLUGS` conhecido.
- O valor **cru** de `?plano` **nunca** pode ser interpolado no DOM. A UI só exibe o
  rótulo pt-BR obtido por `getPlan(slugValidado).nome`. Isso previne injeção de
  conteúdo via query string.
- `parsePlanSlug`, `getPlan`, `PlanSlug` e `PLAN_SLUGS` devem permanecer **intactos
  em contrato** (assinatura e comportamento). Adicionar `price_cents` + helper BRL
  é **aditivo** — não altera o fluxo de validação.

## Requisitos verificáveis

### RF — Fonte única de planos (`src/lib/plans.ts`)
- **RF01** Cada `Plan` expõe `price_cents: number` inteiro: Individual `5900`,
  Clínica `14900`, Pro `25900`. Valor em **centavos inteiros** (convenção `*_cents`),
  nunca float, nunca string.
- **RF02** Existe um helper de formatação BRL exportado (ex.: `formatBRL` /
  `formatPlanPrice`) que converte `price_cents` → string pt-BR: `5900 → "R$ 59"`,
  `14900 → "R$ 149"`, `25900 → "R$ 259"`.
- **RF03** `PlanSlug`, `PLAN_SLUGS`, `parsePlanSlug`, `getPlan` e `Plan` (campos
  atuais) permanecem com contrato intacto; a mudança é puramente aditiva.
- **RF04** `clinica` permanece o único `recomendado: true` (ancoragem de pricing).

### RF — Página de preços (`/precos`)
- **RF05** `/precos` renderiza os três planos **consumindo `PLANS`** — sem lista
  duplicada e sem valor colado fora de `src/lib/plans.ts`.
- **RF06** Cada card mostra: valor mensal em BRL (via helper RF02), público-alvo,
  benefícios ampliados (pt-BR), selo "Recomendado" **apenas** na Clínica, e CTA
  "Começar com o {nome}" apontando para `/cadastro?plano={slug}`.
- **RF07** Remover a copy "valores chegam em breve"/"valores e contratação chegam em
  breve". Incluir nota discreta em pt-BR de que a contratação acontece ao criar a
  conta — **sem checkout, sem billing**.

### RF — Landing (`src/marketing/pages.tsx`)
- **RF08** Hero com CTA reforçada (continua levando a `/cadastro` e `/precos`).
- **RF09** Seção de benefícios / "para quem é".
- **RF10** Seção de prévia de planos com valores em BRL (consumindo `PLANS`, mesma
  fonte da `/precos`) + link "Ver planos" para `/precos`.
- **RF11** (Opcional) FAQ curto em pt-BR.
- **RF12** Ilustração decorativa via CSS/SVG/componente (sem assets externos),
  marcada `aria-hidden="true"`.

### RF — Header de marketing (`MarketingLayout.tsx`)
- **RF13** Adicionar link/botão "Entrar" apontando para `/login`, acessível por
  teclado e com foco visível (padrão de `focus-visible:ring` já usado no header).

### RF — Painel de autenticação (`AuthLayout.tsx`)
- **RF14** Enriquecer o `aside` (painel esquerdo, `≥1024px`) com ilustração
  CSS/SVG decorativa (`aria-hidden="true"`) + lista de 3–4 funcionalidades em pt-BR:
  agenda sem conflito, confirmação D-1, cobrança PIX, baixa automática.
- **RF15** O `aside` continua `hidden lg:flex` (só em telas largas); as rotas
  cadastro/recuperar-senha que reusam o layout continuam funcionando.

### RNF (herdados do projeto, aplicáveis aqui)
- **RNF01** TypeScript estrito; sem `any`. `price_cents` tipado como `number`.
- **RNF02** shadcn/ui reaproveitado de `src/components` (Button, StatusBadge,
  PlaceholderPanel já existentes) — não recriar componentes.
- **RNF03** Mobile-first + dark mode (tokens de tema existentes: `bg-card`,
  `text-muted-foreground`, `border-border`, `text-primary` etc.).
- **RNF04** Acessibilidade: contraste adequado, foco visível, navegação por teclado,
  ilustrações decorativas com `aria-hidden`, landmarks/headings semânticos.
- **RNF05** Todo texto de usuário em **pt-BR**.

## Critérios de aceite testáveis

- **CA01** Em `src/lib/plans.ts`, `getPlan("individual").price_cents === 5900`,
  `getPlan("clinica").price_cents === 14900`, `getPlan("pro").price_cents === 25900`.
- **CA02** O helper BRL retorna exatamente `"R$ 59"`, `"R$ 149"`, `"R$ 259"` para
  os respectivos `price_cents`.
- **CA03** `parsePlanSlug` mantém o comportamento atual: `null` para entrada inválida
  (`parsePlanSlug("hacker") === null`, `parsePlanSlug(null) === null`), slug válido
  normalizado para entrada com caixa/espaço (`parsePlanSlug(" CLINICA ") === "clinica"`).
  Contrato de `getPlan`/`PlanSlug`/`PLAN_SLUGS` inalterado.
- **CA04** `/precos` exibe os três valores em BRL; o selo "Recomendado" aparece **só**
  no card da Clínica; cada CTA aponta para `/cadastro?plano={slug}` com o slug correto.
- **CA05** Nenhuma ocorrência de "chegam em breve" permanece em `/precos` nem na
  landing (verificável por busca de texto).
- **CA06** A landing exibe os mesmos valores BRL da `/precos` (consistência entre as
  duas telas, pois ambas consomem `PLANS`); há link "Ver planos" → `/precos`.
- **CA07** `grep` por valores literais (`"R$ 59"`, `5900`, `14900`, `25900`,
  `"Individual"`, `"Clínica"`, `"Pro"`) **não** encontra lista de planos duplicada
  fora de `src/lib/plans.ts` — landing e `/precos` só importam `PLANS`/helper.
- **CA08** O valor cru de `?plano` **não** é interpolado no DOM: o fluxo de
  `/cadastro` continua usando `parsePlanSlug` → `getPlan(slug).nome`. (Verificável
  por inspeção de código: nenhum `searchParams.get("plano")` renderizado direto.)
- **CA09** Header de marketing tem elemento "Entrar" para `/login` focável por
  teclado (Tab) com anel de foco visível.
- **CA10** `AuthLayout` no `aside` tem ilustração com `aria-hidden="true"` e lista de
  3–4 funcionalidades em pt-BR.
- **CA11** Todas as ilustrações novas (landing + auth) têm `aria-hidden="true"` e não
  há `<img src=...>` de asset externo (CSS/SVG/componente apenas).
- **CA12** `npm run build` + typecheck/lint/test existentes passam sem erro.
- **CA13** QA visual (Chrome DevTools) em `/`, `/precos`, `/login` em **mobile** e
  **dark mode**: layout íntegro, foco visível no "Entrar", valores consistentes
  landing↔`/precos`, **sem erros no console**.
- **CA14** (Segurança/dados) Nenhum arquivo em `supabase/migrations` é criado ou
  alterado; nenhum import de cliente Supabase/service role aparece nos arquivos
  tocados; `tenants.plan` não é lido nem escrito; nenhum plano é persistido.

## Valor de negócio
- Aumenta conversão de cadastro (CTA mais forte, valores transparentes, ancoragem na
  Clínica, acesso a login visível).
- Transmite produto mais completo/profissional sem antecipar Fase 3 (sem cobrança
  real), mantendo custo de infra zero (tudo estático no frontend).

## Enquadramento no roadmap
- **Fase atual (marketing/auth, pré-operacional):** esta melhoria vive aqui. Plano =
  conteúdo de marketing; tenant nasce em `trial`; CTA → `/cadastro`, nunca checkout.
- **Fase 3 (NÃO fazer agora):** billing/checkout, uso efetivo de `tenants.plan`,
  cobrança de assinatura. Acoplar preço a billing nesta tarefa é **defeito explícito**.
- Os valores R$ 59/149/259 são **conteúdo de marketing**; mudá-los no futuro é editar
  `src/lib/plans.ts`, não uma migration.

## Fora de escopo
- Qualquer alteração de schema/migration/RLS/Edge Function (não há superfície de dados).
- Persistir plano, escrever em `tenants.plan`, criar cobrança/checkout/billing.
- Assets de imagem externos (ilustração é CSS/SVG/componente).
- Alterar o contrato de `parsePlanSlug`/`getPlan`/`PlanSlug`.

## Pontos levantados pelo usuário — rastreabilidade (nenhum descartado)
| Ponto do usuário | Onde é atendido |
|---|---|
| Landing simples, melhorar CTA | RF08 |
| Planos sem valor / mal descritos → valores + mais info | RF01, RF02, RF05, RF06, RF10 |
| Falta botão de login no header | RF13, CA09 |
| Painel esquerdo do login quase vazio → imagem + o que o sistema faz | RF14, CA10 |
| Valores 59/149/259 | RF01, CA01, CA02 (em centavos: 5900/14900/25900) |
| Clínica recomendada (ancoragem) | RF04, CA04 |
| Ilustração via CSS/SVG, decorativa aria-hidden | RF12, RF14, CA11 |
| pt-BR, mobile-first, dark mode, acessibilidade | RNF03–05, CA13 |
```