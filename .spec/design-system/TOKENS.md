# Tokens do Design System (Marketing)

**Fonte de verdade:** `src/tokens-shadcn.css` (compilado dos DTCG em
`.agents/skills/design-system/profiles/shadcn/tokens/`) + `DESIGN.md` §2 +
`tailwind.config.ts`. A landing do template (`src/pages/LandingPage.tsx`,
Storybook `Pages/LandingPage`) é a fonte visual da verdade para composição e
escalas. Nenhum token inventado — componentes em `src/components/marketing/*`
consomem apenas os tokens abaixo.

> **Atualizado em 2026-11-20:** o sistema saiu de HSL (`hsl(var(--token))`) para
> **oklch puro**. Os valores antigos em HSL ficaram apenas no histórico do git
> (`git show HEAD:src/index.css`); não são mais aplicáveis.

## Cores (oklch via CSS variables)

Tokens semânticos (claro/escuro). Classes Tailwind correspondentes entre parênteses.

| Token CSS | Classe Tailwind | Claro (`:root`) | Escuro (`.dark`) |
|---|---|---|---|
| `--background` | `bg-background` | `oklch(0.985 0 0)` | `oklch(0.145 0 0)` |
| `--foreground` | `text-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--card` | `bg-card` | `oklch(1 0 0)` | `oklch(0.205 0 0)` |
| `--card-foreground` | `text-card-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--primary` | `bg-primary`/`text-primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` |
| `--primary-foreground` | `text-primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--secondary` | `bg-secondary` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--secondary-foreground` | `text-secondary-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--muted` | `bg-muted` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--muted-foreground` | `text-muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` |
| `--accent` | `bg-accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--accent-foreground` | `text-accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--destructive` | `text-destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |
| `--border` | `border-border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--input` | `border-input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` |
| `--ring` | `ring-ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |

Modificadores de opacidade (`bg-primary/90`, `border-border/60`) continuam
funcionando: `tailwind.config.ts` usa
`color-mix(in oklab, var(--token) calc(<alpha> * 100%), transparent)`.

### Tokens `status-*` e `service-*`

Preservados dos ADR-06 e ADR-01, convertidos dos HSL originais para oklch por
HSL → sRGB → OKLab → OKLCH (CSS Color 4 §7.1/§19), sem alterar a cor. Exemplos
(tema claro): `--status-pendente: oklch(0.7118 0.1517 70.83)`,
`--status-confirmado: oklch(0.5282 0.1016 165.36)`,
`--service-1: oklch(0.5398 0.2018 298.5)`. Todos os 44 valores (7 pares × 2
temas + 8 serviços × 2 temas) estão em `src/tokens-shadcn.css`. Cada par
`--status-*/--status-*-fg` atinge ≥ 4,5:1 nos dois temas
(`src/contrast-tokens.test.ts`).

Cores de status de marketing (indicadores) usam opacidade sobre fundo neutro:
`emerald-500`, `sky-500`, `amber-500`, `violet-500`, `rose-500` (ex.:
`bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`). Apenas para
indicadores, nunca fundo de card inteiro.

## Tipografia

- `font-sans`: Inter (400/500/600).
- `font-display`: Space Grotesk (500/600).
- `font-mono`: JetBrains Mono (400/500).

Escalas usadas na landing (template `src/pages/LandingPage.tsx`):
- Headline hero: `text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.15]`.
- Headline seção: `text-3xl sm:text-4xl font-extrabold tracking-tight`.
- Subheadline: `text-sm sm:text-base text-muted-foreground leading-relaxed`.
- Eyebrow: `text-xs font-bold uppercase tracking-wider text-primary`.
- Microcopy/trust: `text-xs text-muted-foreground`.

## Espaçamento

- Seções: `py-20 sm:py-28`; bloco final `py-12`/`py-24`.
- Container: `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8`.
- Grid bento: `grid-cols-1 md:grid-cols-12 gap-6`.
- Cards: `p-6 sm:p-8`; gaps internos `gap-3`, `gap-6`.
- Ritmo vertical da página: `space-y-16` (marketing) / `gap-6` (admin).
- Navbar sticky `h-16`; `html { scroll-padding-top: 4rem }` evita que âncoras
  de seção fiquem sob o header.

## Raios

Base `--radius: 0.625rem` (template shadcn, claro/escuro). Derivados Tailwind:
`rounded-sm` (calc -4px), `rounded-md` (calc -2px), `rounded-lg` (= radius).
Componentes da landing usam `rounded-2xl` (cards), `rounded-full` (chips/pills),
`rounded-xl` (blocos internos).

## Sombras

- Cards: `shadow-xs`.
- Hero showcase: `shadow-[0_16px_48px_rgba(0,0,0,0.08)]`.
- Botões primários: `shadow-md`.
- Rim light superior: `h-px bg-gradient-to-r from-transparent via-foreground/15 (ou /20, /25) to-transparent`.

## Animações

- `animate-pulse` (chip dot), `animate-ping` (indicador ao vivo),
  `transition-colors`, `transition-transform`.
- FAQ: chevron do `Accordion` gira via
  `[&[data-state=open]>svg]:rotate-180` (não `group-open:` — o estado é
  `data-state` do Radix). Ver `.spec/design-system/COMPONENTS.md`.
