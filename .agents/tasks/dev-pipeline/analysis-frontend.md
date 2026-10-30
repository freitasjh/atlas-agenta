# Design de Frontend: Marketing + Auth mais maduros (landing, /preços, painel de login)

Status: design doc para o planner e para o gate humano do PRD. Nenhum código de aplicação foi escrito.

Demanda (verbatim do usuário, autoritativa): a landing hoje é simples demais — sem valores, sem botão de login, só cadastro. Melhorar a CTA; a seção de planos precisa ser melhor descrita, com mais informações e **valores**; o painel esquerdo do login pode ter mais informações e uma imagem explicando o que o sistema faz; hoje falta informação básica sobre o que é e quais as funcionalidades do produto.

Tipo: melhoria de UI frontend. Escopo 100% público/frontend. **Não toca** dados, Supabase, RLS ou Edge Functions. As CTAs continuam levando a `/cadastro?plano=<slug>` e `/login`. O tenant continua nascendo em `trial`. Billing/checkout é Fase 3.

Decisões já travadas com o usuário (mensagens 2–4):
- Valores mensais: Individual **R$ 59**, Clínica **R$ 149**, Pro **R$ 259**. Armazenar em **centavos inteiros** (`5900`, `14900`, `25900`) em `src/lib/plans.ts`, com helper de formatação BRL curta (`R$ 59`). Clínica é o recomendado (ancoragem de pricing).
- Objetivo duplo: conversão + aparência mais completa. Seções novas aceitas: benefícios/para-quem-é, prévia de planos na landing, FAQ curto.
- Ilustração do painel de login e da landing: **gerada via CSS/SVG/componentes**, sem assets externos. Decorativa, `aria-hidden`.
- Adicionar link/botão **"Entrar"** (para `/login`) no header de marketing.

Premissas verificadas no repositório:
- `src/lib/plans.ts` é a fonte única apresentacional dos planos (ADR-13). Hoje expõe `PLAN_SLUGS`, `PlanSlug`, `Plan {slug,nome,publico,destaques,recomendado?}`, `PLANS` (ordem Individual→Clínica→Pro, só `clinica` com `recomendado`), `parsePlanSlug`, `getPlan`. **Não tem preço.** `parsePlanSlug` é o único ponto de validação do `?plano` não confiável; o valor cru nunca é interpolado no DOM.
- `src/marketing/pages.tsx` tem `LandingPage` (hero + 3 `Feature`), `PrecosPage` (grade de 3 planos **sem valor**, com a copy "Valores e contratação chegam em breve") e `TermosPage`. O componente local `Feature` e `StatusBadge` já são reusados.
- `src/marketing/MarketingLayout.tsx` tem header com `MARKETING_LINKS` (`/precos`, `/termos`) + `ThemeToggle`. **Não tem link de login.**
- `src/auth/AuthLayout.tsx` tem o `aside` de apresentação (só em `lg:`, ≥1024px) com `Logo`, um `h2` curto e um parágrafo. É o painel a enriquecer. É compartilhado por login, cadastro e recuperar-senha.
- `src/lib/money.ts` tem `formatCentsToBRL` (ex.: `4500` → `R$ 45,00`) e `parseBRLToCents`. O `formatCentsToBRL` **mostra os centavos** (`R$ 59,00`), e o aceite pede `R$ 59`. Por isso um helper curto é necessário (seção 5.1).
- Tokens de cor/tipografia em `src/index.css` + `tailwind.config.ts`: app inicia em **dark** (`ThemeProvider`); fontes `Space Grotesk` (display) e `Inter` (sans) auto-hospedadas; `--primary` jade (`160 64% 45%` dark / `160 64% 38%` claro), `--radius: 0.75rem`. `tabular-nums` global no `body`.
- Pattern de navegação confirmado: `Button asChild` + `Link` renderiza `<a href>` semântico (acessível). Seguir sempre.

## 1. Telas, componentes e rotas

Nenhuma rota nova é criada. Todas as rotas afetadas já existem e são públicas, sem guard de autenticação, RBAC ou status de assinatura. Isto é marketing/auth público. (Os guards de `/app` e `/admin` — auth + RBAC + `subscription_status`, com `bloqueado` redirecionando para quitação — não são tocados aqui e ficam registrados como contexto, não como trabalho.)

| Rota | Componente | Situação |
|------|------------|----------|
| `/` | `LandingPage` (`src/marketing/pages.tsx`) | Existente. Hero reforçado + benefícios/para-quem-é + prévia de planos + FAQ curto. |
| `/precos` | `PrecosPage` (`src/marketing/pages.tsx`) | Existente. Grade com valor em BRL, público-alvo, benefícios ampliados, selo "Recomendado" só na Clínica, nota de contratação sem checkout. |
| `/termos` | `TermosPage` | Inalterada. |
| `/login`, `/cadastro`, `/recuperar-senha` | `AuthLayout` + páginas | Só o `aside` do `AuthLayout` muda (ilustração + lista de funcionalidades). As páginas de formulário não mudam. |
| (layout) | `MarketingLayout` | Ganha o link/botão "Entrar" → `/login` no header. |

Componentes e onde vivem:

- `src/lib/plans.ts` — estendido: `price_cents` por plano + helper `formatPlanPrice`. Continua a fonte única; landing e `/precos` **consomem** dela (nunca duplicam a lista nem colam o valor).
- `src/marketing/pages.tsx` — `LandingPage` e `PrecosPage` reescritas para o novo conteúdo. O componente local `Feature` é mantido e reusado. Novos sub-componentes locais de marketing (ver abaixo) ficam neste arquivo ou em `src/marketing/` se crescerem.
- `src/marketing/MarketingLayout.tsx` — header ganha "Entrar".
- `src/auth/AuthLayout.tsx` — `aside` enriquecido.

Sub-componentes de marketing (locais, não são primitivos de UI — não vão para `src/components/ui`):

- `PlanCard` — um card de plano, consumindo um `Plan` de `PLANS` + `formatPlanPrice(plan)`. Usado tanto em `/precos` (completo) quanto, em versão compacta, na prévia da landing, via uma prop `variant: "full" | "preview"`. Fonte única de markup do card, evita a divergência visual entre landing e `/precos`.
- `BrandIllustration` — ilustração SVG/CSS decorativa (`aria-hidden`), reusada pelo hero da landing e pelo `aside` do login. Representa a tese do produto: a transição `pendente → confirmado` + um balão de WhatsApp + um selo de PIX. Sem asset externo.
- `Faq` — lista curta de perguntas e respostas (3–4) na landing.

Decisão sobre a ilustração compartilhada: um único `BrandIllustration` parametrizável (prop de tamanho/densidade) em vez de dois SVGs separados. Motivo: a mesma tese visual ("anel de confirmação" da marca + estado confirmado) aparece nas duas telas; um componente só garante consistência e um ponto único de manutenção. A alternativa (dois SVGs inline distintos) foi descartada por duplicar markup decorativo.

## 2. Direção visual e design system

### 2.1 Plano

Assunto: um micro-SaaS que tira o dono de serviço (barbearia, clínica, estúdio) do ciclo "lembrar o cliente na unha + correr atrás do PIX". O público da landing é esse dono, quase sempre no **celular**, decidindo em segundos se o produto resolve a dor dele. A única função da landing é: deixar claro o que o produto faz e levar ao cadastro. A função de `/precos` é: dar o preço e o tamanho certo, e levar ao cadastro com o plano escolhido.

Tese do hero: **o horário que se confirma sozinho e se paga sozinho.** O hero abre com a coisa mais característica do produto — a transição de estado `pendente → confirmado` — já presente hoje como um par de `StatusBadge`. A melhoria mantém essa tese e a amplia numa ilustração que mostra o ciclo completo em miniatura: lembrete no WhatsApp → confirmação → PIX pago. Não é o template "número gigante + label": é o artefato real do produto (badges de status + balão de conversa + selo PIX), que ninguém confunde com outra landing.

Por que isso não é o default genérico: os três clusters de IA (cream + serifa + terracota; preto + verde-ácido; broadsheet com fios) são rejeitados. A paleta já é escolhida pelo projeto (ardósia/azul-noite + jade), a tese vem do domínio (confirmação de agendamento), e a assinatura — a transição de status viva — é específica deste produto, não decorativa. A régua de boldness é gasta num lugar só: a ilustração do ciclo. Todo o resto (tipografia, espaçamento, cards) fica disciplinado e quieto.

Cores: **sem tokens novos.** Tudo sai de `src/index.css`.
- `background` / `foreground`: base calma (ardósia escuro no dark, neutro claro no claro).
- `card`: superfície de cada feature, plano e do `aside` de login.
- `primary` (jade): acento — ícones, régua da ilustração, borda do plano recomendado, foco. Nunca em texto corrido sobre `background` no tema **claro** (reprova contraste, ver 2.4).
- `muted` / `muted-foreground`: corpo secundário, descrições, notas.
- `accent`: chip de ícone das features (já é o padrão do `Feature` atual).
- Badges de status na ilustração: tokens `--status-pendente` / `--status-confirmado` via `StatusBadge` existente.

Tipografia (sem fonte nova): `Space Grotesk` (display) para `h1`/`h2`/`h3` e para o número do preço; `Inter` (sans) para corpo e listas; `tabular-nums` já global alinha os valores R$. Escala:
- `h1` do hero: `font-display`, `clamp(1.75rem, 5vw, 2.75rem)`, `font-semibold`, `leading-tight`, `tracking-tight` (já é o padrão atual — mantido).
- `h2` de seção: `font-display text-2xl font-semibold tracking-tight`.
- Preço do plano: `font-display`, `text-4xl font-semibold`, com `/mês` em `text-sm text-muted-foreground` ao lado.
- Corpo: `text-base` (hero) / `text-sm` (cards), `text-muted-foreground`.
- Eyebrow/chip: `text-xs font-medium uppercase tracking-wide text-muted-foreground` (padrão do chip atual do hero — reusado).

Layout: mobile-first. Uma coluna no celular; grades `sm:grid-cols-2` / `sm:grid-cols-3` para features e planos; o container de marketing continua `max-w-5xl`. O `aside` do login só aparece em `lg:`; no mobile o formulário ocupa a tela toda, sem a ilustração (regra do layout atual — preservada).

Assinatura: a ilustração do ciclo `pendente → confirmado → PIX pago`, com o "anel de confirmação" jade da marca ecoado. É o elemento que a pessoa lembra. Aparece no hero e, em escala menor, no `aside` do login.

Esboço — landing (mobile):

```
[chip] Agenda + cobrança num só lugar
H1  Confirme cada horário e receba na hora,
    direto pelo WhatsApp.
parágrafo de subtítulo
[ Começar agora ]  (CTA primária, size lg)
[ Ver planos ]     (CTA secundária, outline)
prova social curta / linha de confiança (sem métrica inventada)

+-- BrandIllustration (aria-hidden) --------+
|  WhatsApp  →  [Pendente]→[Confirmado]     |
|  lembrete D-1        PIX pago ✓           |
+-------------------------------------------+

## Como o Atlas Agenda trabalha por você
[Feature] [Feature] [Feature]   (3, já existem)

## Feito para o seu dia a dia   (benefícios / para quem é)
- Barbearias e estúdios
- Clínicas e consultórios
- Autônomos de serviço
(cada um com 1 linha do ganho concreto)

## Planos                       (prévia)
[PlanCard preview] x3  (valor em BRL, selo na Clínica)
[ Ver todos os planos ] → /precos

## Perguntas frequentes
(3–4 Q&A)
```

Esboço — `/precos` (desktop, 3 colunas):

```
H1 Planos e preços
parágrafo: escolha pelo tamanho da equipe (sem "chegam em breve")

+-- Individual --+  +-- Clínica ★ --+  +-- Pro --------+
| Autônomo       |  | [Recomendado] |  | Multi-prof.   |
| R$ 59 /mês     |  | Equipe        |  | R$ 259 /mês   |
| ✓ ...          |  | R$ 149 /mês   |  | ✓ ...         |
| ✓ ...          |  | ✓ ...         |  | ✓ ...         |
| [Começar com   |  | [Começar com  |  | [Começar com  |
|  o Individual] |  |  o Clínica]   |  |  o Pro]       |
+----------------+  +---------------+  +---------------+

nota discreta: a contratação acontece ao criar a conta; sem cartão agora.
```

Esboço — `aside` do login (lg):

```
[Logo]

BrandIllustration (aria-hidden, menor)

H2  Agenda e cobrança, sem no-show.
parágrafo curto
✓ Agenda sem conflito por profissional
✓ Confirmação automática 24h antes (D-1)
✓ Cobrança por PIX ao fim do atendimento
✓ Baixa automática do pagamento

(rodapé do aside: linha discreta de marca)
```

### 2.2 Componentes

Reusados de `src/components` / `src/components/ui`, sem recriar:
- `Button` (com `asChild` + `Link`), `Card`/`CardHeader`/`CardContent`/`CardFooter` onde o padrão de card ajudar, `Separator`, `Badge`.
- `StatusBadge` (`src/components/StatusBadge.tsx`) na ilustração do ciclo — reusa os tokens de status, não inventa cor.
- `Logo` (`src/components/Logo.tsx`) no `aside`.
- `ThemeToggle` no header (já está).
- `formatCentsToBRL` **não** serve para o preço de marketing (mostra `,00`); usar o novo `formatPlanPrice` (seção 5.1).

Sem `Accordion`: não existe `accordion` em `src/components/ui`. O FAQ usa `<details>/<summary>` nativos (acessível por padrão, sem dependência nova) estilizados com Tailwind, **ou** uma lista estática de Q&A. Decisão: `<details>/<summary>` nativo — dá expandir/colapsar acessível de teclado sem adicionar Radix Accordion. Alternativa descartada: instalar `@radix-ui/react-accordion` só para 3 perguntas (peso desnecessário no bundle).

Novos (locais de marketing, não primitivos):
- `PlanCard` (`variant: "full" | "preview"`).
- `BrandIllustration`.
- `Faq`.

### 2.3 Estados visuais e badges

- Plano recomendado (Clínica): borda `border-primary`, selo "Recomendado" (pílula `border-primary/30 bg-primary/10 text-primary`) — padrão já existente, mantido. No desktop pode receber um leve destaque de elevação (`shadow-sm` + `-translate-y` sutil apenas em `lg:`, respeitando `prefers-reduced-motion`), sem virar outro componente.
- Planos não recomendados: `border-border bg-card`.
- CTA primária: `Button` default (jade). CTA secundária/"Ver planos"/"Entrar": `outline` ou `ghost`.
- Badges de status na ilustração: `StatusBadge status="pendente"` e `status="confirmado"`, com seta `→` decorativa `aria-hidden`.
- A ilustração inteira é decorativa: `role` nenhum, `aria-hidden="true"` no container; o significado já está no texto ao redor.

### 2.4 Copy pt-BR

Toda a copy em pt-BR, voz afirmativa, sem jargão de sistema, sem métrica inventada.

| Contexto | Texto |
|----------|-------|
| Header — novo item | "Entrar" (leva a `/login`) |
| Hero — chip | "Agenda + cobrança num só lugar" (mantido) |
| Hero — H1 | "Confirme cada horário e receba na hora, direto pelo WhatsApp." (mantido) |
| Hero — subtítulo | mantido do atual |
| Hero — CTA primária | "Começar agora" → `/cadastro` |
| Hero — CTA secundária | "Ver planos" → `/precos` |
| Benefícios — título | "Feito para o seu dia a dia" |
| Benefício (barbearia/estúdio) | "Barbearias e estúdios: encaixe rápido e lembrete que derruba o buraco na agenda." |
| Benefício (clínica) | "Clínicas e consultórios: confirmação 24h antes e menos faltas sem ligar para ninguém." |
| Benefício (autônomo) | "Autônomos: cobre por PIX assim que termina e receba sem cobrar na mão." |
| Prévia de planos — título | "Escolha o plano do tamanho da sua equipe" |
| Prévia — link | "Ver todos os planos" → `/precos` |
| `/precos` — H1 | "Planos e preços" (mantido) |
| `/precos` — subtítulo | "Escolha pelo tamanho da sua equipe. Comece grátis e só contrate quando criar a conta." (substitui "Valores e contratação chegam em breve") |
| Preço | "R$ 59" / "R$ 149" / "R$ 259", com "/mês" ao lado em `muted-foreground` |
| Público-alvo | "Autônomo" / "Equipe" / "Multi-profissionais" (de `plan.publico`) |
| Selo | "Recomendado" (só Clínica) |
| CTA do card | "Começar com o {nome}" → `/cadastro?plano={slug}` (mantido) |
| Nota de contratação | "A contratação acontece ao criar a conta. Nenhum cartão é pedido agora." |
| FAQ Q1 | "Preciso instalar algo?" / "Não. O Atlas Agenda roda no navegador do celular e do computador." |
| FAQ Q2 | "Como funciona o WhatsApp?" / "Você conecta o número da empresa uma vez e as mensagens de confirmação e cobrança saem automaticamente." |
| FAQ Q3 | "Como o cliente paga?" / "Ao fim do atendimento, enviamos um PIX com QR Code e copia e cola. A baixa é automática quando o pagamento cai." |
| FAQ Q4 | "Posso trocar de plano depois?" / "Pode. Comece pelo plano que couber hoje e ajuste conforme a equipe cresce." |
| Login `aside` — H2 | "Agenda e cobrança, sem no-show." (mantido) |
| Login `aside` — funcionalidades | "Agenda sem conflito por profissional" · "Confirmação automática 24h antes" · "Cobrança por PIX ao fim do atendimento" · "Baixa automática do pagamento" |

Regra de voz: o botão diz o que acontece ("Começar agora", "Entrar"). O FAQ responde em uma frase. A nota de contratação é honesta sobre não haver checkout agora — alinha com a Fase 3 sem prometer o que não existe.

### 2.5 O que foi descartado

- Métrica de prova social com número ("90% menos faltas"): descartada — número inventado sem fonte vira ruído e risco de credibilidade. Se houver dado real no futuro, entra depois.
- Banner/modal de cookies ou newsletter: fora de escopo.
- Carrossel/slider no hero: descartado — a ilustração estática do ciclo comunica melhor e é mais acessível.
- Animação de entrada elaborada: no máximo uma transição discreta de hover/elevação no card recomendado, respeitando `prefers-reduced-motion`. Nada de orquestração de scroll — não acrescenta informação.
- Radix Accordion para o FAQ: descartado em favor de `<details>` nativo.

## 3. Acessibilidade

Contraste WCAG calculado a partir dos tokens de `src/index.css` (os pares que a melhoria introduz ou destaca). Valores são estimativas de cálculo HSL→luminância; o QA deve medir no DOM renderizado.

| Par | Tema | Razão aprox. | Resultado |
|-----|------|--------------|-----------|
| `foreground` sobre `background` | Escuro | ~16,7:1 | Passa AA/AAA |
| `foreground` sobre `card` | Escuro | ~15:1 | Passa |
| `muted-foreground` sobre `background` | Escuro | ~7:1 | Passa AA texto normal |
| `muted-foreground` sobre `card` | Escuro | ~6,7:1 | Passa |
| `foreground` sobre `background` | Claro | ~16,8:1 | Passa |
| `muted-foreground` sobre `card` | Claro | ~5,6:1 | Passa |
| `primary-foreground` sobre `primary` (botão/CTA) | Claro | ~3,2:1 | Limítrofe para texto normal; **pré-existente em todo o app**. Ver nota abaixo. |
| `primary` como texto sobre `background` | Claro | ~3,3:1 | Reprova texto normal. **Não usar `primary` em texto corrido no claro** — só em ícone/borda/preço com peso display grande (≥24px bold conta como "texto grande", AA 3:1). |
| `ring` (foco) sobre `background` | Claro | ~2,7:1 | Limítrofe 3:1 não-textual; **pré-existente**. |

Notas:
- Os itens limítrofes de `primary`/`ring` no tema claro são pré-existentes e afetam todo o app; esta tarefa não os piora. Recomendo ao planner **não** bloquear a entrega por eles, mas registrar como dívida de token (o ajuste já foi recomendado em design anterior: `--primary` claro → `160 64% 30%`, `--ring` claro → `160 64% 32%`). O preço "R$ 149" em jade só é aceitável se for `display` grande e em peso semibold (texto grande, 3:1); por segurança, **o preço usa `foreground`, não `primary`** — o jade fica na borda/selo do card recomendado. Isso remove o risco sem depender do ajuste de token.

Demais requisitos:
- Landmarks: `MarketingLayout` já tem `header`/`nav`/`footer`. Hero em `<section>`, cada bloco com `aria-labelledby` ligado ao seu `h2` (padrão atual mantido). FAQ em `<section aria-labelledby>`.
- "Entrar" no header: é `Button asChild` + `Link`, `<a href="/login">` com `focus-visible:ring-2 ring-ring ring-offset-2` (herdado do `Button`), alcançável por Tab, ativável por Enter. Fica na mesma `nav`, na ordem após os links de conteúdo e antes/junto do `ThemeToggle`.
- CTAs e cards: cada CTA é `<a>` real (pattern `Button asChild + Link`); nenhum `onClick` em `div`.
- Ilustração: `aria-hidden="true"`, não é a única fonte de informação — o texto adjacente carrega o significado. Nenhum texto essencial vive só dentro do SVG.
- FAQ `<details>/<summary>`: expandível por teclado por padrão; `summary` recebe foco visível; o conteúdo é lido por leitores de tela.
- Preço: número em `tabular-nums` (global), com "/mês" como texto, não como sinal só visual. O valor não depende de cor.
- `prefers-reduced-motion`: já respeitado pelo CSS global; qualquer hover/elevação do card recomendado precisa respeitar o media query (usar `transition` que o CSS global neutraliza).
- Mobile: alvos de toque ≥40px (CTAs usam `size="lg"` = `h-11`; links do header `px-3 py-2`).
- `aside` do login só em `lg:` (sem ilustração no mobile) — nenhuma informação essencial fica escondida no mobile, porque a funcionalidade está no formulário e na landing.

## 4. Arquitetura React

### 4.1 Camadas

- **Sem dados de servidor.** Não há `useQuery`/`useMutation` nesta tarefa: landing, `/precos` e o `aside` de login são estáticos, alimentados por `PLANS` (módulo puro). Nenhum `fetch`, nenhum `useEffect` para dados, nenhum cliente Supabase novo. (A regra "dados sempre via TanStack Query" continua valendo quando houver dado de servidor — aqui não há.)
- Páginas e componentes de marketing são puramente apresentacionais e sem estado, exceto o FAQ (estado de aberto/fechado é do próprio `<details>`, sem React state).
- A validação do `?plano` continua **exclusivamente** em `parsePlanSlug` (em `/cadastro`, inalterado). Esta tarefa não introduz nova leitura de `?plano`: as CTAs apenas **geram** `/cadastro?plano={slug}` a partir do `slug` já tipado de `PLANS` (nunca interpola valor cru).

### 4.2 Fonte única de planos

- `PlanCard` recebe um `Plan` inteiro (de `PLANS.map`) e chama `formatPlanPrice(plan)` para o rótulo BRL. Landing (preview) e `/precos` (full) consomem o **mesmo** `PlanCard` e o **mesmo** `PLANS`. Proibido: colar `59`/`149`/`259` no JSX, duplicar a lista, ou derivar o preço fora de `plans.ts`.
- O valor consistente entre landing e `/precos` é garantido por construção: ambos leem `plan.price_cents` via `formatPlanPrice`. O QA confere a igualdade visualmente (seção 6).

### 4.3 Sem formulário novo

Nenhum formulário é adicionado. As páginas de auth (login/cadastro/recuperar-senha) mantêm `react-hook-form` + `zodResolver` exatamente como estão; só o `aside` compartilhado muda, e ele não tem formulário.

## 5. Mudanças em `src/lib/plans.ts` (fonte única)

### 5.1 Campo e helper

- Adicionar `price_cents: number` à `interface Plan` e preencher: `individual` → `5900`, `clinica` → `14900`, `pro` → `25900`. Centavos inteiros, consistente com a convenção `*_cents`.
- Adicionar helper de formatação BRL **curta** (sem centavos), porque `money.ts/formatCentsToBRL` renderiza `R$ 59,00` e o aceite pede `R$ 59`:

```ts
const BRL_WHOLE = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/** Formata o preço mensal do plano em BRL sem centavos (ex.: `R$ 59`). */
export function formatPlanPrice(plan: Plan): string {
  return BRL_WHOLE.format(plan.price_cents / 100);
}
```

Decisão: helper **dedicado em `plans.ts`**, não em `money.ts`. Motivo: `money.ts` é a borda de dinheiro operacional do domínio (sempre 2 casas, para valores de serviço/cobrança); o preço de marketing é "redondo" por decisão de produto e não deve mudar o formatador operacional. Mantém as duas preocupações separadas. Alternativa descartada: passar `maximumFractionDigits` como opção em `formatCentsToBRL` — polui a borda operacional com um caso de marketing.

- `PlanSlug`, `parsePlanSlug`, `getPlan`, `PLAN_SLUGS`, `PLANS` permanecem intactos em assinatura e comportamento. `PlanSlug` continua **fora** de `src/types/domain.ts` (plano não é persistido; Fase 3).

### 5.2 Invariantes

- `price_cents` é dado de marketing, não acopla a billing/checkout e não toca `tenants.plan`. Está em `plans.ts` justamente para que a promoção à Fase 3 (mapear `slug → tenants.plan` + preço de cobrança real) tenha um ponto único.
- A ilustração e os textos nunca derivam preço de outra fonte.

## 6. Critério de aceite visual (QA com Chrome DevTools MCP)

Todos sem erro no console. Cada item precisa de evidência (snapshot/medição). Rodar em mobile (390px) e desktop (1280px), tema **claro e escuro**.

1. `src/lib/plans.ts` expõe `price_cents` (`5900`/`14900`/`25900`) e `formatPlanPrice` retorna `R$ 59` / `R$ 149` / `R$ 259`. `PlanSlug`/`parsePlanSlug`/`getPlan` inalterados (typecheck + testes existentes passam).
2. `/precos`: os três planos mostram valor mensal em BRL, público-alvo, benefícios ampliados; selo "Recomendado" **só** na Clínica; CTA "Começar com o {nome}" leva a `/cadastro?plano={slug}` (conferir o `href` real). Sem a copy "valores chegam em breve". Nota de contratação sem checkout presente.
3. Landing: hero com CTA primária + "Ver planos"; seção de benefícios/para-quem-é; seção de prévia de planos com os **mesmos** valores de `/precos` + link "Ver todos os planos" → `/precos`; FAQ presente e expansível por teclado.
4. Consistência: o valor de cada plano na prévia da landing é idêntico ao de `/precos` (vêm de `PLANS` via `formatPlanPrice`).
5. Header de marketing tem "Entrar" → `/login`, com foco visível e ativável por teclado (Tab + Enter).
6. `aside` do login (em ≥1024px): ilustração CSS/SVG decorativa (`aria-hidden`) + lista de 4 funcionalidades. No mobile (<1024px) o `aside` não aparece e o formulário ocupa a tela.
7. A ilustração é `aria-hidden` e nenhum texto essencial vive só dentro dela.
8. Mobile-first e dark mode: layout não quebra em 390px nem em 1280px, nos dois temas. Medir contraste no DOM em: subtítulo do hero, descrição de feature, preço do plano, nota de contratação — ≥4,5:1 (texto normal) ou ≥3:1 (texto grande/preço display).
9. Nenhum valor cru de `?plano` é interpolado no DOM; as CTAs usam `slug` de `PLANS`. (Conferir que `/cadastro?plano=xpto` inválido continua caindo no `parsePlanSlug` → `null`, sem quebrar — comportamento pré-existente, não regredido.)
10. `npm run build` + typecheck/lint/testes existentes passam.

## 7. Dependências de dados

Nenhuma. A tarefa não precisa de tabela, política RLS, Edge Function, variável de ambiente nem migration. `price_cents` é constante de marketing em `plans.ts`, não persistido. Não há leitura/escrita de Supabase. Isto é registrado explicitamente para o planner: **não** abrir ADR de schema para esta demanda.

## 8. Arquivos

Modificar:
- `src/lib/plans.ts` — `price_cents` na interface + nos 3 planos; `formatPlanPrice`.
- `src/marketing/pages.tsx` — `LandingPage` (hero + benefícios + prévia + FAQ) e `PrecosPage` (preço + benefícios + nota) reescritas; consomem `PLANS`/`formatPlanPrice`/`PlanCard`.
- `src/marketing/MarketingLayout.tsx` — item "Entrar" → `/login` no header.
- `src/auth/AuthLayout.tsx` — `aside` com `BrandIllustration` + lista de funcionalidades.

Criar (sub-componentes locais de marketing):
- `PlanCard` (`variant` full/preview) — em `src/marketing/pages.tsx` ou `src/marketing/PlanCard.tsx` se crescer.
- `BrandIllustration` — em `src/marketing/BrandIllustration.tsx` (reusado por landing e login; por isso componente próprio, não inline em `pages.tsx`).
- `Faq` — em `src/marketing/pages.tsx` (local da landing).

Não tocar: `src/lib/money.ts` (formatador operacional), `src/auth/*Page.tsx` (formulários), `parsePlanSlug`/`getPlan`/`PlanSlug`, qualquer coisa de `src/app`/`src/admin`, Supabase/migrations/Edge Functions.

## 9. Testabilidade

- Unitário: `formatPlanPrice` tem saída determinística (`R$ 59`/`R$ 149`/`R$ 259`) — teste direto em `plans.test.ts` se o planner quiser cobrir a regressão de formato (sem `,00`). Barato e vale a pena, porque o aceite trava o formato exato.
- Integração/visual: landing, `/precos` e `aside` de login são verificados por QA Chrome DevTools (seção 6) — layout, consistência de valores, foco, dark mode, contraste.
- A consistência landing↔`/precos` é testável por construção (fonte única) e confirmável visualmente; não precisa de mock de servidor porque não há servidor.

---

Resumo para o planner: demanda **toca tela**, é frontend público puro, **sem dependência de dados**. Estender `plans.ts` (fonte única) com `price_cents` + `formatPlanPrice`; reescrever landing e `/precos` consumindo `PLANS` via um `PlanCard` compartilhado; adicionar "Entrar" no header de marketing; enriquecer o `aside` do `AuthLayout` com `BrandIllustration` (SVG/CSS, `aria-hidden`) + 4 funcionalidades. Preço tratado como conteúdo de marketing (centavos inteiros, nunca acopla a checkout). Boldness concentrada na ilustração do ciclo `pendente→confirmado→PIX`; resto quieto. Não abrir ADR de schema.
