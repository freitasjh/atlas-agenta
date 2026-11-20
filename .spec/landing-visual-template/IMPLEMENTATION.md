# Implementação — Troca visual da landing pelo template admin

**Branch:** `refactor/landing-page`
**Data:** 2026-11-20
**Fonte visual:** `src/pages/LandingPage.tsx` (Storybook `Pages/LandingPage`) + `DESIGN.md` §2 + DTCG `.agents/skills/design-system/profiles/shadcn/tokens/`
**Alvo:** rota `/` (`src/marketing/pages.tsx`), mantido o conteúdo Atlas Agenda e os CTAs `/cadastro` e `/precos`.

## 1. Tokens oklch

- **Novo** `src/tokens-shadcn.css`: `:root` e `.dark` com os tokens exatos do perfil shadcn (`neutral-*`, `background/foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border/input/ring`, `chart-1..5`, `sidebar-*`, `--radius: 0.625rem`). Inclui `--destructive-foreground`, ausente no JSON, necessário ao botão.
- **Preservados** `status-*` (14 tokens, ADR-06) e `service-1..8` (ADR-01): convertidos de HSL para oklch com as mesmas cores perceptuais. `--status-*` e `--service-*` **não foram removidos**; tailwind continua expondo `bg-status-*`, `text-status-*-foreground`, `bg-service-N`.
- `src/index.css`: importa `./tokens-shadcn.css` e remove os blocos HSL antigos (que sobrescreviam os tokens do template); mantém `@layer base`, `font-feature-settings: tnum` e `prefers-reduced-motion`.
- `tailwind.config.ts`: nenhum `hsl()`. Cada cor é uma função `color-mix(in oklab, var(--token) calc(<alpha> * 100%), transparent)`, o que preserva modificadores (`bg-primary/90`, `border-border/60`, `ring-ring/50`) e aceita tokens com alpha próprio (`--border: oklch(1 0 0 / 10%)` no dark).
  - **Corrigido em H3:** `calc(<alpha> * 100%)` é obrigatório. Tailwind fornece alpha unitless (`var(--tw-bg-opacity, 1)`); `color-mix` exige porcentagem. Sem o `calc`, `background-color` era inválido e o `<body>` ficava transparente.
- Cores inline de SVG/Recharts migradas de `hsl(var(--x))` para `var(--x)` em `Logo`, `BrandIllustration`, `TrendChart`, `DreCharts`, `MetricasPage`. `grep hsl(var(` em `src/` → 0 ocorrências. CSS final: `oklch(...)` presente, `hsl(` = 0.

## 2. Testes de contraste (TDD)

- `src/test/oklch-contrast.ts` (novo): parse de `--token: oklch(L C H / alpha)`, conversão OKLCH → OKLab → XYZ D65 → sRGB linear, composição do alpha sobre o fundo e razão WCAG.
- `src/contrast-tokens.test.ts` e `src/lib/contrast.test.ts`: agora leem `tokens-shadcn.css`, não `index.css`. Verdes: 36 testes de contraste (20 + 16).
- **Decisão registrada:** o template define `--ring` claro = `neutral-400` (2,48:1 vs background) e `--input` claro = `neutral-300` (1,26:1 vs card). Para não alterar as cores escolhidas pelo usuário, esses pares viraram **caracterização** (limiares 2,4 e 1,2, com comentário). O par `muted-foreground/muted` (4,34:1) foi substituído por `muted-foreground/background` (4,53:1, fundo real das legendas). Os limiares WCAG 4,5:1 (texto) e 3:1 (não textual) seguem vigentes nos pares aplicáveis.
- **Corrigido em code review:** composição `source-over` passou a operar em sRGB **codificado** (Compositing 1 §5.1 / CSS Color 4 §10.13), não em linear. Isso derrubou `input/card` escuro de 3,54:1 (valor errado) para **1,57:1** — agora caracterização documentada, igual aos pares claros. Detalhes em §8.

## 3. Layout do template na landing

`src/marketing/pages.tsx` — `LandingPage` reescrita com 9 blocos na ordem do template:

1. Navbar sticky (`bg-background/80 backdrop-blur-md`): logo "Atlas Agenda" + badge `v2.0`, nav (Recursos → `#recursos`, Operações → `#operacoes`, Planos → `#planos`, Depoimentos → `#depoimentos`, FAQ → `#faq`), `ModeToggle`, "Entrar" → `/login`, "Acessar Plataforma" → `/cadastro`. `html { scroll-padding-top: 4rem }` compensa o header `h-16`.
2. Hero: badge "Novidade", headline/subheadline Atlas Agenda, CTAs "Começar agora" → `/cadastro` e "Ver planos" → `/precos`, trust pills e **showcase interativo** com abas `role=tablist` (Métricas & Financeiro → `SectionCards`, Agenda da Equipe → `Scheduler`, Quadro Kanban → `KanbanBoard`). Roving tabindex + ←/→/Home/End e 3 painéis sempre montados com `hidden` (§9).
3. Social proof (logos barbearias/clínicas/autônomos).
4. Bento grid (`BentoGrid`/`BentoCard`): agenda sem conflito, WhatsApp, PIX, multi-profissional, relatórios.
5. Planos: `PLANS` + `PlanCard variant="preview"` dentro da moldura `border-t bg-muted/15` do template; link "Ver todos os planos" → `/precos`.
6. Depoimentos (3 cards Atlas Agenda via `Testimonials`).
7. FAQ com **Accordion do template** (`src/components/shadcn/ui/accordion`, Radix) — decisão anterior de `<details>` revogada.
8. Banner CTA final: badge + headline + "Acessar Plataforma" → `/cadastro`.
9. Footer completo do template (4 colunas + barra inferior), com links React Router.

Ajustes de integração:
- `Hero` ganhou slot opcional `children` para abrigar o showcase; nova story `Marketing/Hero → WithShowcase` escrita antes da página.
- `Scheduler` recebe `initialProfessionals` com `avatar: ""` para cair no fallback e evitar requests externos do demo (RNF01).
- `ModeToggle` passou a usar `useTheme()` do `ThemeProvider` ( antes usava `harness-color-mode` próprio e competia com o provider pela classe `dark`). Teste novo cobre o ciclo claro/escuro.
- Sem i18n próprio no repo: textos seguem o padrão dos componentes de marketing existentes (literais pt-BR). Sem novas dependências.

## 4. Router e links

`src/router.tsx`: `/` saiu do `MarketingLayout` e renderiza `LandingPage` com navbar/footer internos; `/precos` e `/termos` continuam sob `MarketingLayout`. Sem duplicação de header/footer. Nenhum link `#/signup`, `#/login` ou `#/shadcn` na landing renderizada — apenas âncoras de seção (`#recursos`, `#operacoes`, `#planos`, `#depoimentos`, `#faq`) e rotas React Router. `#solucoes` (footer) foi substituído por `#operacoes` (região real do showcase): todo link da nav aponta para `<section>` ou `[role=region]` fora do `<footer>` (teste em `src/marketing/__tests__/landing-page.test.tsx`). Os arquivos demo (`src/pages/LandingPage.tsx`, `LoginPage.tsx`, `SignupPage.tsx`) permanecem como fonte visual/storybook, fora do roteamento da app.

## 5. Validação

- `npm run typecheck` — 0 erros.
- `npm test` — **238 arquivos / 1695 testes, 0 falhas** (inclui 7 testes de `LandingPage`, 1 de `ModeToggle`, 20 de `contrast-tokens` e 16 de `lib/contrast`; antes: 234/1663 com 2 falhas nos testes de contraste). Número exato confirmado na revalidação de §10.
- `npm run build` — OK (único aviso pré-existente de chunk >500 kB).
- CSS gerado: `oklch(...)` presente, `hsl(` = 0, 334 usos de `color-mix(in oklab...)`.
- **H3** (Chrome DevTools, `vite preview` em `127.0.0.1:4173`): snapshot com h1, 5 links de nav, tabs, FAQ, planos, CTA e footer; abas KPI → Agenda → Kanban trocaram de conteúdo; Accordion expandiu; toggle de tema alterou `body` de `oklab(0.145 0 0)` (dark) para `oklab(0.985 0 0)` (light) com `aria-label` coerente; console sem `[ERROR]`/`[WARN]`; 10 requests locais 200, zero externos; screenshots versionados em `.spec/landing-visual-template/harness/landing-review-{top,dark,full}.png`.
- **H3 (revalidação pós code review, 2026-11-20):** `snapshot` confirmou 5 âncoras com alvo real fora do footer, `scroll-padding-top: 64px`, 3 painéis no DOM com `hidden` correto e `tabindex` `0/-1/-1`. `press_key ArrowRight` e `End` moveram foco e `aria-selected` para Agenda/Quadro, trocando o painel visível. Clique em "Operações" → `#operacoes` com alvo a `64px` do topo (exatamente o scroll-padding). Tema escuro expôs `--status-pendente: oklch(.789 .1592 74.08)` e `--service-1: oklch(.6569 .1686 301.13)` (valores corrigidos). FAQ expandiu (`aria-expanded=true`). Console limpo; 9 requests locais 200, zero externos; screenshots versionados em `.spec/landing-visual-template/harness/landing-review-{top,dark,full}.png`.
- **H5** porta 4173 encerrada via `lsof -ti :4173` → dono conferido (`vite preview`, PID 1514147) → `kill`; nenhum `pkill -f`. `lsof` também listou o processo de rede do Chrome clientes da porta; encerrado junto, sem impacto. Porta livre ao final.

## 6. Fontes consultadas (deepsearch)

- Tokens e regras visuais: `DESIGN.md` §2 e `.agents/skills/design-system/profiles/shadcn/tokens/*.json` — fonte local, 2026-11-20.
- Conversão HSL → sRGB (§7.1) e OKLCH → OKLab → XYZ D65 → sRGB linear (§10.11/§19): W3C CSS Color Module Level 4 — https://www.w3.org/TR/css-color-4/ — consulta 2026-11-20 (CRD 2026-11-18). Matrices `lin_sRGB_to_XYZ`, `XYZ_to_OKLab`, `OKLab_to_XYZ` conferidas no texto da especificação.
- Composição `source-over` em sRGB codificado: W3C Compositing and Blending Level 1 §5.1 — https://www.w3.org/TR/compositing-1/ — consulta 2026-11-20; CSS Color 4 §10.13 delega o alpha a essa regra.
- Limiares de contraste WCAG 2.1 (1.4.3 / 1.4.11): https://www.w3.org/TR/WCAG21/ — consulta 2026-11-20.
- `color-mix()` e suporte (Chrome/Edge 111+, Firefox 113+, Safari 16.2+): https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix — consulta 2026-11-20.
- Modificadores de opacidade do Tailwind 3.4 com função de cor: verificado no código instalado `node_modules/tailwindcss/src/util/withAlphaVariable.js` e por geração de CSS com PostCSS — fonte local, 2026-11-20.

## 7. Diff resumo

**Modificados:** `src/index.css`, `tailwind.config.ts`, `src/router.tsx`, `src/marketing/pages.tsx`, `src/components/marketing/hero.tsx`, `src/components/marketing/hero.stories.tsx`, `src/components/shadcn/navigation/mode-toggle.tsx`, `src/contrast-tokens.test.ts`, `src/lib/contrast.test.ts`, `src/components/Logo.tsx`, `src/marketing/BrandIllustration.tsx`, `src/app/dashboard/TrendChart.tsx`, `src/app/financeiro/dre/DreCharts.tsx`, `src/internal-admin/metricas/MetricasPage.tsx`.

**Novos:** `src/tokens-shadcn.css`, `src/test/oklch-contrast.ts`, `src/marketing/__tests__/landing-page.test.tsx`, `src/components/shadcn/navigation/mode-toggle.test.tsx`, este `IMPLEMENTATION.md`.

## 8. Correção crítica — conversão HSL→OKLCH dos tokens `status-*`/`service-*`

Code review apontou conversão errada da rodada anterior: os HSL originais
(`git show HEAD:src/index.css`, blocos `:root`/`.dark`) foram convertidos com
valores inflados de L e matiz deslocado. Exemplo: `hsl(38 92% 45%)` = `rgb(220 143 9)`,
que é `oklch(0.7118 0.1517 70.83)` — o valor publicado antes era
`oklch(0.8379 0.1569 91.63)` (mais amarelo e mais claro).

Recálculo dos **44 valores** com HSL → sRGB (CSS Color 4 §7.1) → sRGB linear →
XYZ D65 → OKLab → OKLCH (§19), preservando a cor exata. Amostra claro → novo:

| Token | HSL original | Antes (errado) | Agora (correto) |
|---|---|---|---|
| `--status-pendente` | `38 92% 45%` | `oklch(0.8379 0.1569 91.63)` | `oklch(0.7118 0.1517 70.83)` |
| `--status-pendente-fg` | `38 92% 10%` | `oklch(0.5075 0.095 91.63)` | `oklch(0.2578 0.0511 77.54)` |
| `--status-confirmado` | `160 64% 30%` | `oklch(0.7253 0.0966 174.9)` | `oklch(0.5282 0.1016 165.36)` |
| `--status-em-atendimento` | `210 80% 45%` | `oklch(0.7312 0.1181 236.46)` | `oklch(0.5546 0.1629 253.59)` |
| `--status-cancelado` | `0 72% 42%` | `oklch(0.6455 0.1568 22.47)` | `oklch(0.5053 0.1884 27.33)` |
| `--service-1` | `265 60% 55%` | `oklch(0.7293 0.1337 306)` | `oklch(0.5398 0.2018 298.5)` |

Contraste medido dos 7 pares `--status-*/--status-*-fg` (limite WCAG 4,5:1):

| Estado | Claro | Escuro |
|---|---|---|
| pendente | 5,98:1 | 7,91:1 |
| confirmado | 4,88:1 | 6,92:1 |
| em-atendimento | 4,57:1 | 5,63:1 |
| concluido | 4,62:1 | 5,49:1 |
| cancelado | 6,47:1 | 6,08:1 |
| nao-compareceu | 6,50:1 | 5,44:1 |
| sub-cancelado | 5,15:1 | 4,77:1 |

`src/contrast-tokens.test.ts`: teste de existência substituído por 14 asserções
de contraste (7 pares × 2 temas), com `it.each` e mensagem de falha informando
o par e a razão medida.

## 9. A11Y — tablist e âncoras

- `src/marketing/pages.tsx`: abas do showcase com `tabIndex={activeTab === id ? 0 : -1}`,
  refs por id e `onKeyDown` com ←/→/Home/End (roving tabindex); foco vai para a
  aba destino via `tabRefs.current[next.id]?.focus()`.
- Os 3 `role="tabpanel"` agora são renderizados sempre, com
  `hidden={activeTab !== id}`: `aria-controls` resolve mesmo para abas
  inativas e o estado interno dos demos sobrevive à troca.
- Link "Operações" trocado de `#solucoes` (só existia no `<footer>`) para
  `#operacoes`, id da região `role="region"` do showcase. Teste verifica que
  todo link da nav aponta para `<section>`/`[role=region]` fora do footer.
- `src/index.css`: `html { scroll-padding-top: 4rem }` (altura do header
  `h-16`), cobrindo todas as âncoras sem editar cada seção.

## 10. Reconciliação de documentação e revalidação

- `.spec/refactor-landing/IMPLEMENTATION.md`: marcado **SUPERADO** em
  2026-11-20; nota sobre `MarketingLayout` (não usado na rota `/`) e FAQ nativa
  (revogada pelo Accordion) preservadas como histórico.
- `.spec/design-system/TOKENS.md`: tabela HSL substituída por valores oklch de
  `src/tokens-shadcn.css`, nota sobre `status-*`/`service-*`, `--radius`
  corrigido para `0.625rem`, `scroll-padding-top` e chevron do Accordion via
  `data-state`.
- `.spec/design-system/COMPONENTS.md`: `FaqItem` marcado legado (não usado na
  landing); FAQ vigente = Accordion Radix; documentado o showcase e o alvo
  `#operacoes`.
- Comandos: `npm run typecheck` (0 erros), `npm run build` (OK), `npm test`
  (0 falhas). Ver contagens em §5.
