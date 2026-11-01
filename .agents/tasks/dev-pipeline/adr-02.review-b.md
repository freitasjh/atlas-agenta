# Parecer do Revisor B — ADR-02: Componente `BrandIllustration` (SVG/CSS, decorativo)

Componente de apresentação puro novo (`src/marketing/BrandIllustration.tsx`, 148 linhas, um único arquivo no commit `4e568bc`) que materializa a tese visual do produto — ciclo `lembrete WhatsApp → pendente → confirmado → PIX pago` — reusando `StatusBadge` e os tokens de marca, sem asset externo, sem dados, sem dependência nova. Fonte única parametrizada por `variant: "hero" | "aside"` para servir as duas telas que o consomem (ADR-05 landing e ADR-06 aside do login), que ainda não existem.

Watch for: nada bloqueante. Um ponto menor de aderência ao design (confidence: confirmed) sobre o balão de WhatsApp pintar o ícone em `--primary` em vez do `accent`/`muted` que o design reserva ao chip de feature — cosmético, sem impacto de fronteira e invisível para AT por o container ser `aria-hidden`.

**Verdict**: APPROVED

## Visão de alto nível

A ADR-02 é a peça de menor risco do pacote: zero dados, zero Supabase, zero rota, zero dependência nova. Não há superfície multi-tenant, RLS, RBAC, idempotência, segredo ou PII a avaliar — nada disso é tocado, e isso é correto para um componente decorativo. A revisão se concentra em aderência à ADR/design doc e às regras de design system (tokens, acessibilidade).

Aderência à ADR: todos os critérios de aceite batem. Markup SVG/CSS inline (CA RF12/CA11), `aria-hidden="true"` no container raiz, nenhum `<img src=…>` de asset externo, prop `variant` dando as duas densidades a partir de uma única definição (CA reuso), cores só via `hsl(var(--token))` de tokens existentes sem nenhum token novo (CA tokens), e compila sob `strict` sem `any` (CA tipos). A verificação isolada que a ADR pede — typecheck + inspeção de que o markup é decorativo e sem asset — está satisfeita.

Design system e acessibilidade: o `aria-hidden` no container é o ponto certo e torna o contraste interno (badges, texto do balão, "PIX recebido") não-normativo para leitores de tela, exatamente como o design doc §2.3 previu. Sem animação nem transição, então a nota de `prefers-reduced-motion` do design é atendida por ausência de movimento. `StatusBadge status="pendente"`/`"confirmado"` é reuso correto da fonte única de estados; `cn` e os tokens (`--primary`, `--accent`, `--muted`, `--card`, `--border`, `--muted-foreground`, `--status-*`) foram todos verificados como pré-existentes em `src/index.css`/Tailwind.

Contraprova: `npm run typecheck` (tsc -b) limpo, `npm run build` limpo, `npm test` 95/95 passando. Não há script de lint no projeto — o gate de qualidade é o typecheck, que passa. Verificação visual (render real nos dois tamanhos, console limpo) fica para o QA da ADR-07/08 via Chrome DevTools, conforme a própria ADR; não cabe a este step.

<details>
<summary>Issues (1)</summary>

1. **Ícone do balão em `--primary` vs. acento de feature (não bloqueante)** — o chip do balão de WhatsApp usa `bg-accent` + ícone com `stroke="hsl(var(--primary))"`, enquanto o design doc §2.1/§2.3 reserva `accent` ao chip de ícone de feature e concentra o jade na régua da ilustração/anel. É escolha estética dentro dos tokens permitidos (nenhum token novo), invisível para AT (container `aria-hidden`), e a própria ADR deixa o markup fino a cargo do coder. Ajuste opcional, não condiciona a aprovação.

</details>

<details>
<summary>Details</summary>

### Fronteiras (multi-tenant / RLS / RBAC / idempotência / segredos / LGPD)

Nada a avaliar. O componente não importa cliente Supabase, não recebe `tenant_id`, não lê `?plano` nem qualquer entrada do cliente, não dispara rede, não toca `localStorage`/cookies, não loga, não manipula PII. A única entrada externa são as duas props (`variant`, `className`), tipadas e sem efeito fora de classes de layout. `className` é concatenado via `cn(...)` depois das classes base (mesmo contrato de `StatusBadge`/`Button`), sem abrir risco de fronteira. Registrar a ausência de superfície sensível é a verificação que cabia aqui.

### Aderência à ADR e ao design doc

Divergência cosmética (confidence: confirmed): o design doc §2.1/§2.3 descreve `accent` como "chip de ícone das features" e manda concentrar o jade na "régua da ilustração" e no anel. Aqui o chip do balão de WhatsApp usa `bg-accent` com o ícone em `stroke="hsl(var(--primary))"`. Fica dentro do conjunto de tokens permitido e não introduz cor nova (CA tokens preservado), mas espalha o jade além do anel. Como o container é `aria-hidden` e a ADR delega o markup fino ao coder ("o coder escolhe a forma exata"), é observação, não bloqueio.

Fora isso, a implementação cumpre a ADR item a item: três linhas semânticas (balão → par `pendente`/`confirmado` com seta decorativa → anel jade + "PIX recebido") mapeando a tese `lembrete → pendente → confirmado → PIX pago`; `variant` via `VARIANT_STYLES` ajustando só escala sem duplicar o SVG (requisito de reuso); anel como arco aberto em `hsl(var(--primary))` ecoando `Logo.tsx`.

### Acessibilidade e design system

`aria-hidden="true"` no `div` raiz esconde toda a árvore interna para AT. Consequência que importa para a revisão: o contraste interno dos badges e dos textos "Confirma seu horário de amanhã?" / "PIX recebido" não é normativo para WCAG de texto, porque não é exposto a leitores de tela nem é a única fonte de informação — o design doc §3 já tratou isso como não-bloqueante. Sem `transition`/`animate`/`motion`, não há movimento a neutralizar por `prefers-reduced-motion`. Todos os tokens usados existem em `src/index.css`/Tailwind (`--primary`, `--accent`, `--muted`, `--card`, `--border`, `--foreground`, `--status-pendente`, `--status-confirmado`, mais `primary/10` e `primary/40` como opacidades); nenhum `style` inline de cor fora de `hsl(var(--token))`.

### Contraprova

| Checagem | Resultado |
|---|---|
| `npm run typecheck` (`tsc -b`) | passou, sem erro |
| `npm run build` (`tsc -b && vite build`) | passou (warning pré-existente de chunk >500kB, não relacionado) |
| `npm test` (`vitest run`) | 95/95 testes passaram |
| lint | não há script `lint` no projeto; gate de qualidade é o typecheck |

Verificação visual (render nos dois `variant`, console limpo, dark/claro, mobile/desktop) é escopo do QA (ADR-07/08) via Chrome DevTools, não deste step — a própria ADR define isso.

### Mudanças fora de escopo no commit

Nenhuma. O commit `4e568bc` adiciona um único arquivo novo e nada mais. Não houve alteração colateral em `plans.ts`, `pages.tsx`, `AuthLayout.tsx` ou qualquer outro ponto — o que é coerente com a ADR-02 ser a peça isolável consumida depois pelas ADR-05/06.

</details>

<details>
<summary>Arquivos no escopo da ADR-02</summary>

- `src/marketing/BrandIllustration.tsx` — novo componente de apresentação decorativo (SVG/CSS inline, `aria-hidden`, prop `variant`), único arquivo do commit `4e568bc`.

Diff completo: `git show 4e568bc`.

</details>
