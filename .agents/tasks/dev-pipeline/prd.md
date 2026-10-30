# PRD — Marketing e Autenticação maduros (landing, /precos, painel de login)

> Contrato da demanda. Descreve **o que** precisa existir e **como se prova** que
> ficou pronto. A solução técnica detalhada (componentes, assinatura de funções,
> ordem de implementação) vem nas ADRs do planejamento, após a aprovação humana
> deste PRD.
>
> Fontes: análise de dados/segurança (`analysis-data.md`), análise de frontend
> (`analysis-frontend.md`), steerings do projeto (produto, domínio, stack,
> segurança/multi-tenant, convenções) e as mensagens verbatim do usuário.
>
> **Status de dados/segurança (consenso das duas análises): demanda SEM superfície
> de dados.** Não toca banco, Supabase, RLS, Auth, Edge Functions, migrations nem
> schema. É melhoria de UI 100% pública e estática no frontend.

---

## 1. Problema e valor de negócio

Hoje a camada pública do Atlas Agenda é minimalista demais e não vende o produto:

- A landing tem CTA fraca, não mostra preço e não dá acesso a login (só a cadastro).
- A página de planos lista os três planos **sem valor** e com a copy "valores
  chegam em breve" — o visitante não consegue decidir nem dimensionar.
- O painel esquerdo do login (`aside` do `AuthLayout`) está quase vazio: um título
  curto e um parágrafo, sem explicar o que o sistema faz nem suas funcionalidades.

Quando esta demanda estiver pronta:

- **Mais conversão de cadastro.** Hero com CTA reforçada, valores transparentes
  (R$ 59 / R$ 149 / R$ 259), ancoragem no plano Clínica (recomendado) e acesso a
  login visível no header reduzem o atrito da decisão.
- **Percepção de produto completo e profissional.** Seções novas (benefícios /
  para-quem-é, prévia de planos na landing, FAQ curto, painel de login com
  ilustração e funcionalidades) transmitem maturidade sem antecipar a Fase 3.
- **Custo de infra mantido perto de zero.** Tudo é estático no frontend; nenhuma
  cobrança real, nenhum dado novo, nenhuma chamada de servidor.

Objetivo duplo confirmado com o usuário: **conversão + aparência mais completa.**

---

## 2. Escopo

### 2.1 Dados / Supabase — NADA

- Nenhuma tabela nova, nenhuma coluna de banco, nenhum tipo de domínio novo.
- **Nenhuma migration.** Não criar, editar ou tocar `supabase/migrations`. Uma ADR
  que proponha migration para esta demanda está errada por definição.
- Nenhuma política RLS, RBAC, Auth ou Edge Function é criada, exercida ou relaxada.
- `price_cents` adicionado a `src/lib/plans.ts` é **constante TypeScript de
  marketing**, não coluna de Postgres. Segue a convenção de nome `*_cents` (inteiro)
  por consistência conceitual, mas vive em código.
- `tenants.plan` não é lido nem escrito; nenhum plano é persistido; o tenant
  continua nascendo em `trial`.

### 2.2 Frontend — o trabalho

Tudo em rotas públicas já existentes (sem rota nova, sem guard de auth/RBAC/status):

- `src/lib/plans.ts` — **fonte única** dos planos. Estender de forma **aditiva** com
  `price_cents` por plano + helper de formatação BRL curta. Contrato de `PlanSlug`,
  `PLAN_SLUGS`, `parsePlanSlug`, `getPlan` e dos campos atuais de `Plan` permanece
  intacto.
- `src/marketing/pages.tsx` — `LandingPage` e `PrecosPage` reescritas para o novo
  conteúdo, **consumindo `PLANS`** (nunca duplicando a lista nem colando valor).
- `src/marketing/MarketingLayout.tsx` — header ganha o item "Entrar" → `/login`.
- `src/auth/AuthLayout.tsx` — `aside` (painel esquerdo, `≥1024px`) enriquecido com
  ilustração decorativa e lista de funcionalidades. Compartilhado por
  login/cadastro/recuperar-senha; as páginas de formulário **não** mudam.
- Sub-componentes locais de marketing (não primitivos de `src/components/ui`):
  um card de plano reutilizável (landing em versão compacta e `/precos` em versão
  completa, para garantir que o valor exibido seja o mesmo nas duas telas), uma
  ilustração de marca via CSS/SVG (reusada pelo hero e pelo `aside`) e um FAQ curto.

### 2.3 Fora de escopo

- Qualquer alteração de schema/migration/RLS/Edge Function/Auth.
- Persistir plano, escrever em `tenants.plan`, criar cobrança, checkout ou billing —
  **isso é Fase 3**. Acoplar preço a billing nesta tarefa é **defeito explícito**.
- Alterar o contrato de `parsePlanSlug` / `getPlan` / `PlanSlug` / `PLAN_SLUGS`.
- Assets de imagem externos — a ilustração é CSS/SVG/componente.
- Link público de autoagendamento, taxa de reserva antecipada, métricas
  consolidadas (fora de escopo do MVP / Fase 3 por `produto.md`).
- Mudar formatador operacional `src/lib/money.ts` (borda de dinheiro do domínio).
- Instalar nova dependência (ex.: Radix Accordion) só para o FAQ.

---

## 3. Requisitos e critérios de aceite testáveis

Cada requisito traz entrada → saída observável. IDs de requisito (RF) e de aceite
(CA) unificam a numeração das duas análises.

### 3.1 Fonte única de planos (`src/lib/plans.ts`)

- **RF01** Cada `Plan` expõe `price_cents: number` inteiro — Individual `5900`,
  Clínica `14900`, Pro `25900`. Centavos inteiros, nunca float, nunca string.
  - **CA01** `getPlan("individual").price_cents === 5900`,
    `getPlan("clinica").price_cents === 14900`,
    `getPlan("pro").price_cents === 25900`.
- **RF02** Existe helper de formatação BRL **curta** exportado de `plans.ts` que
  converte `price_cents` → string pt-BR sem centavos.
  - **CA02** O helper retorna exatamente `"R$ 59"`, `"R$ 149"`, `"R$ 259"` para
    `5900` / `14900` / `25900`. (Decisão: helper dedicado em `plans.ts`, separado do
    `formatCentsToBRL` de `money.ts`, que mostra `R$ 59,00` — ver §7.)
- **RF03** `PlanSlug`, `PLAN_SLUGS`, `parsePlanSlug`, `getPlan` e os campos atuais de
  `Plan` permanecem com contrato intacto; a mudança é puramente aditiva. `PlanSlug`
  continua fora de `src/types/domain.ts` (plano não é persistido).
  - **CA03** `parsePlanSlug("hacker") === null`, `parsePlanSlug(null) === null`,
    `parsePlanSlug(" CLINICA ") === "clinica"`. Contrato de `getPlan`/`PlanSlug`/
    `PLAN_SLUGS` inalterado.
- **RF04** `clinica` permanece o único `recomendado: true` (ancoragem de pricing).

### 3.2 Página de preços (`/precos`)

- **RF05** `/precos` renderiza os três planos **consumindo `PLANS`** — sem lista
  duplicada e sem valor colado fora de `src/lib/plans.ts`.
  - **CA07** Busca por literais (`"R$ 59"`, `5900`, `14900`, `25900`, nomes dos
    planos) **não** encontra lista de planos duplicada fora de `src/lib/plans.ts`;
    landing e `/precos` só importam `PLANS`/helper.
- **RF06** Cada card mostra: valor mensal em BRL (via RF02), público-alvo,
  benefícios ampliados em pt-BR, selo "Recomendado" **apenas** na Clínica, e CTA
  "Começar com o {nome}" apontando para `/cadastro?plano={slug}`.
  - **CA04** `/precos` exibe os três valores em BRL; o selo "Recomendado" aparece
    **só** no card da Clínica; cada CTA aponta para `/cadastro?plano={slug}` com o
    slug correto (conferir o `href` real renderizado).
- **RF07** Remover a copy "valores chegam em breve" / "valores e contratação chegam
  em breve". Incluir nota discreta em pt-BR de que a contratação acontece ao criar a
  conta — **sem checkout, sem billing**.
  - **CA05** Nenhuma ocorrência de "chegam em breve" permanece em `/precos` nem na
    landing. A nota de contratação sem checkout está presente.

### 3.3 Landing (`src/marketing/pages.tsx`)

- **RF08** Hero com CTA reforçada, continuando a levar a `/cadastro` (primária) e a
  `/precos` (secundária).
- **RF09** Seção de benefícios / "para quem é" (barbearias e estúdios, clínicas e
  consultórios, autônomos de serviço), cada item com o ganho concreto em pt-BR.
- **RF10** Seção de prévia de planos com valores em BRL consumindo `PLANS` (mesma
  fonte da `/precos`) + link "Ver planos" → `/precos`.
  - **CA06** A landing exibe os **mesmos** valores BRL da `/precos` (consistência por
    construção, pois ambas consomem `PLANS`); há link "Ver planos" → `/precos`.
- **RF11** (Opcional, aceito pelo usuário) FAQ curto em pt-BR (3–4 Q&A), expansível
  por teclado. Implementação com `<details>/<summary>` nativo — sem nova dependência.
- **RF12** Ilustração decorativa via CSS/SVG/componente (sem asset externo), marcada
  `aria-hidden="true"`.

### 3.4 Header de marketing (`MarketingLayout.tsx`)

- **RF13** Adicionar link/botão "Entrar" → `/login`, acessível por teclado e com
  foco visível (padrão `Button asChild + Link` → `<a href>` real; `focus-visible:ring`
  já usado no header).
  - **CA09** Header de marketing tem elemento "Entrar" para `/login`, focável por Tab,
    com anel de foco visível e ativável por Enter.

### 3.5 Painel de autenticação (`AuthLayout.tsx`)

- **RF14** Enriquecer o `aside` (`≥1024px`) com ilustração CSS/SVG decorativa
  (`aria-hidden="true"`) + lista de 3–4 funcionalidades em pt-BR: agenda sem
  conflito por profissional, confirmação automática 24h antes (D-1), cobrança por
  PIX ao fim do atendimento, baixa automática do pagamento.
  - **CA10** O `aside` tem ilustração com `aria-hidden="true"` e lista de 3–4
    funcionalidades em pt-BR.
- **RF15** O `aside` continua `hidden lg:flex` (só em telas largas); no mobile o
  formulário ocupa a tela toda. As rotas cadastro/recuperar-senha que reusam o
  layout continuam funcionando.

### 3.6 Segurança frontend (única superfície desta tarefa)

- **RF16** O valor **cru** de `?plano` **nunca** é interpolado no DOM. A validação
  continua **exclusivamente** em `parsePlanSlug` (em `/cadastro`), e a UI só exibe o
  rótulo pt-BR via `getPlan(slugValidado).nome`. As CTAs apenas **geram**
  `/cadastro?plano={slug}` a partir do `slug` já tipado de `PLANS`.
  - **CA08** Nenhum `searchParams.get("plano")` é renderizado direto; o fluxo de
    `/cadastro` segue usando `parsePlanSlug` → `getPlan(slug).nome`. `/cadastro?plano=xpto`
    inválido continua caindo em `parsePlanSlug` → `null` sem quebrar (comportamento
    pré-existente, não regredido).

### 3.7 Requisitos não funcionais (herdados, aplicáveis aqui)

- **RNF01** TypeScript estrito; sem `any`. `price_cents` tipado como `number`.
- **RNF02** shadcn/ui reaproveitado de `src/components` (`Button`, `StatusBadge`,
  `Logo` etc.) — não recriar primitivos.
- **RNF03** Mobile-first + dark mode, usando os tokens de tema existentes
  (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`,
  `--status-*`). Nenhum token de cor novo.
- **RNF04** Acessibilidade: contraste adequado, foco visível, navegação por teclado,
  ilustrações decorativas com `aria-hidden`, landmarks/headings semânticos.
- **RNF05** Todo texto de usuário em **pt-BR**.

### 3.8 Verificação geral

- **CA12** `npm run build` + typecheck/lint/testes existentes passam sem erro.
- **CA14** (segurança/dados) Nenhum arquivo em `supabase/migrations` é criado ou
  alterado; nenhum import de cliente Supabase/service role nos arquivos tocados;
  `tenants.plan` não é lido nem escrito; nenhum plano é persistido; nenhum
  `<img src=…>` de asset externo.

---

## 4. Regras de fronteira que a demanda arrisca

A tarefa não cruza a camada de dados, então as fronteiras invioláveis do projeto
**permanecem verdadeiras e não são exercidas nem relaxadas**. Registradas para
rastreabilidade e como rede de proteção para o planejador e o review:

- **Isolamento multi-tenant (RLS).** `tenant_id` vem do JWT/`profiles`, nunca de
  parâmetro do cliente; RLS em toda tabela de domínio. **Não exercido:** nenhuma
  tabela de domínio é lida/escrita aqui.
- **RBAC admin/professional/receptionist.** Recepção sem acesso a `charges`.
  **Não exercido:** sem leitura de dados operacionais.
- **Status de assinatura** (`trial/ativo/pendente/bloqueado/cancelado`), com
  `bloqueado` redirecionando para quitação — vive nos guards de `/app` e `/admin`,
  **não tocados** por esta demanda (marketing/auth público, sem guard).
- **Webhooks** (idempotência por `gateway_charge_id` + id do evento; autenticidade
  do Asaas). **Não exercido:** sem Edge Function, sem webhook nesta tarefa.
- **Segredos fora do cliente.** Só `anon key` pública vai ao bundle; service role,
  chave Asaas e token Evolution ficam em env/Edge Functions. **Respeitado:** nenhum
  segredo é introduzido; nenhum import de service role nos arquivos tocados.
- **LGPD** (`whatsapp_opt_in`, PII mínima em log). **Não exercido:** sem coleta de
  PII, sem disparo, sem log de dado pessoal nesta tarefa.
- **Entrada não confiável `?plano` (ÚNICA superfície real).** Validada só por
  `parsePlanSlug`; valor cru nunca no DOM — ver RF16/CA08. Esta é a fronteira que a
  demanda de fato toca e precisa preservar.
- **Dinheiro em centavos inteiros.** `price_cents` respeita a convenção `*_cents`
  mesmo sendo constante de marketing; exibição formatada em BRL.

---

## 5. Perfis de acesso

Toda a superfície desta demanda é **pública e anônima** — não há usuário autenticado
nem papel RBAC envolvido na execução das telas.

| Ação | Quem executa |
|------|--------------|
| Ver landing (`/`), preços (`/precos`), termos (`/termos`) | Qualquer visitante anônimo |
| Clicar "Entrar" no header → `/login` | Visitante anônimo (ainda não logado) |
| Clicar CTA de plano → `/cadastro?plano={slug}` | Visitante anônimo |
| Ver o `aside` enriquecido do login/cadastro/recuperar-senha | Visitante anônimo (em telas `≥1024px`) |

Papéis `super_admin` / `admin` / `professional` / `receptionist` só existem **depois**
do login, nas áreas `/admin` e `/app`, que **não** são tocadas aqui. Registrado para
deixar claro que nenhuma regra de papel é alterada.

---

## 6. Enquadramento no roadmap e dependências

- **Fase atual (marketing/auth pré-operacional):** esta melhoria vive aqui. Plano é
  **conteúdo de marketing**; tenant nasce em `trial`; CTA → `/cadastro`, nunca
  checkout. Alinhado com `src/lib/plans.ts` (ADR-13) e `produto.md`.
- **Fase 3 (NÃO fazer agora):** billing/checkout, uso efetivo de `tenants.plan`,
  cobrança de assinatura. `price_cents` fica em `plans.ts` justamente para que a
  promoção à Fase 3 (mapear `slug → tenants.plan` + preço de cobrança real) tenha um
  ponto único. Acoplar preço a billing nesta tarefa é defeito.
- **Fora de escopo do MVP (Fase 1, por `produto.md`):** autoagendamento público,
  taxa de reserva obrigatória antecipada, painel de métricas consolidadas — **não**
  implementar.
- **Dependências anteriores:** nenhuma pendência de dados. A tarefa depende apenas
  dos componentes públicos já existentes (`PLANS`, `MarketingLayout`, `AuthLayout`,
  `Button`, `StatusBadge`, `Logo`) e dos tokens de tema em `src/index.css`.
- Mudar os valores R$ 59/149/259 no futuro é editar `src/lib/plans.ts`, não uma
  migration.

---

## 7. Pontos levantados pelo usuário (nenhum descartado)

Cada ponto das mensagens verbatim e das decisões travadas, mapeado para onde é
atendido ou registrado como decisão.

| Ponto do usuário | Situação | Onde é atendido |
|------------------|----------|-----------------|
| Landing simples demais, melhorar a CTA | Decisão tomada | RF08 |
| Planos sem valor / mal descritos → valores + mais informação | Decisão tomada | RF01, RF02, RF05, RF06, RF10 |
| Falta botão de login no header | Decisão tomada | RF13, CA09 |
| Painel esquerdo do login quase vazio → imagem + o que o sistema faz e funcionalidades | Decisão tomada | RF14, CA10 |
| Valores dos planos: 59 / 149 / 259 (msg 2, item 1) | Decisão tomada | RF01 (5900/14900/25900 em centavos), CA01, CA02 |
| Objetivo = conversão + aparência mais completa (msg 2, item 2 = "c") | Decisão tomada | Seções novas: RF09 (benefícios), RF10 (prévia de planos), RF11 (FAQ) |
| Ilustração via CSS/SVG, sem asset externo, decorativa (msg 2, item 3 = "a") | Decisão tomada | RF12, RF14, CA11/CA14 |
| Clínica como plano recomendado (ancoragem) | Decisão tomada | RF04, CA04 |
| Valores são conteúdo de marketing, não billing; tenant nasce em trial; CTA → /cadastro | Decisão tomada (invariante) | §2.1, §4, §6 |
| pt-BR, mobile-first, dark mode, acessibilidade | Decisão tomada | RNF03–RNF05, CA13 (visual) |
| Helper BRL curto porque `money.ts` mostra `R$ 59,00` e o aceite pede `R$ 59` | Decisão tomada | RF02, CA02 (helper dedicado em `plans.ts`, não altera `money.ts`) |
| FAQ sem instalar Radix Accordion (usar `<details>` nativo) | Decisão tomada | RF11 |
| "pode executar" / "pode rodar o workflow" (msgs 3–4) | Autorização de execução | Processado pelo pipeline; sem decisão de produto pendente |

**Perguntas em aberto:** nenhuma. Todas as escolhas de produto (valores, objetivo
duplo, forma da ilustração, plano recomendado) foram confirmadas nas mensagens 1–2
do usuário. A dívida de token de contraste do tema claro (`--primary`/`--ring`
limítrofes) é **pré-existente** e **não** bloqueia esta entrega — fica como nota ao
planejador, com a mitigação de usar `foreground` (não `primary`) no texto do preço.

---

## 8. Critério de aceite visual (QA via Chrome DevTools MCP)

QA executado em **mobile (390px)** e **desktop (1280px)**, nos temas **claro e
escuro**, todos **sem erro no console**. Cada item exige evidência (snapshot/medição
no DOM renderizado).

1. **CA-V1** `/precos`: os três planos mostram valor mensal em BRL, público-alvo e
   benefícios ampliados; selo "Recomendado" **só** na Clínica; cada CTA
   "Começar com o {nome}" tem `href` real `/cadastro?plano={slug}` com o slug
   correto. Nenhuma copy "valores chegam em breve". Nota de contratação sem checkout
   presente. (RF05–RF07)
2. **CA-V2** Landing: hero com CTA primária + "Ver planos"; seção de benefícios /
   para-quem-é; seção de prévia de planos; FAQ presente e expansível por teclado.
   (RF08–RF11)
3. **CA-V3** Consistência: o valor de cada plano na prévia da landing é **idêntico**
   ao de `/precos` (ambos de `PLANS` via o helper). (CA06)
4. **CA-V4** Header de marketing tem "Entrar" → `/login`, com foco visível e
   ativável por teclado (Tab + Enter). (RF13)
5. **CA-V5** `aside` do login em `≥1024px`: ilustração decorativa (`aria-hidden`) +
   lista de 4 funcionalidades; em `<1024px` o `aside` não aparece e o formulário
   ocupa a tela. (RF14, RF15)
6. **CA-V6** A ilustração é `aria-hidden="true"` e nenhum texto essencial vive só
   dentro dela; nenhum `<img src=…>` de asset externo. (RF12, CA11)
7. **CA-V7** Mobile-first e dark mode: layout íntegro em 390px e 1280px, nos dois
   temas. Medir contraste no DOM em subtítulo do hero, descrição de feature, preço
   do plano e nota de contratação — ≥4,5:1 (texto normal) ou ≥3:1 (texto grande /
   preço display). O preço usa `foreground` (não `primary`) para remover o risco de
   contraste do jade no tema claro.
8. **CA-V8** `?plano` inválido (`/cadastro?plano=xpto`) continua caindo em
   `parsePlanSlug` → `null` sem quebrar; nenhum valor cru de `?plano` aparece no DOM.
   (RF16, CA08)
9. **CA-V9** `npm run build` + typecheck/lint/testes existentes passam. (CA12)

---

## 9. Entrega

- Implementação em **branch nova** + **Pull Request** (padrão do projeto; sem push
  direto em `main`).
- Verificação automatizada (CA12) e QA visual (seção 8) concluídos antes do PR.
- Quando a execução gerar aprendizado durável, registrar no brain conforme a regra
  de aprendizado do projeto.
