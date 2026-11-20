# Catálogo de Componentes (Marketing)

Componentes extraídos de `src/pages/LandingPage.tsx` (**fonte visual da
verdade**) — implementação em `src/components/marketing/`, barrel
`src/components/marketing/index.ts`. A landing pública vigente
(`src/marketing/pages.tsx`, rota `/`) consome esses blocos, mas usa navbar/
footer próprios e `Accordion` do template para a FAQ.

> **Atualizado em 2026-11-20:** a FAQ nativa (`<details>/<summary>`) foi
> revogada na landing pela troca visual para o template admin (Radix
> `Accordion`). `FaqItem` permanece no catálogo como componente legado, sem uso
> na landing atual.

## Hero — `hero.tsx`

- **Fonte (template):** `src/pages/LandingPage.tsx` linhas 109–157 (seção 2: chip, headline, subheadline, CTAs, trust pills). Showcase interativo (linhas 158+) não faz parte do componente — é injetado via `children`.
- **Props:**
  - `chip?: ReactNode`
  - `headline: ReactNode`
  - `subheadline: ReactNode`
  - `primaryCta: HeroCta` (`{ label, to?, href?, onClick?, variant?, icon? }`)
  - `secondaryCta?: HeroCta`
  - `trustPills?: ReactNode[]`
  - `children?: ReactNode` (showcase)
  - `className?: string`
- **A11y:** `<section>` landmark; CTAs são `<button>`/`<a>` com foco visível (Button). Trust pills texto.

## SocialProof — `social-proof.tsx`

- **Fonte:** linhas 267–293 (seção 3).
- **Props:** `eyebrow?: ReactNode`, `logos: ReactNode[]`, `className?`.
- **A11y:** `<section>`; logos como texto (font-mono) com contraste via token.

## BentoGrid — `bento-grid.tsx`

- **Fonte:** linhas 296–312 (cabeçalho da seção 4 + grid).
- **Props:** `id?`, `eyebrow?`, `headline?`, `subheadline?`, `children`, `className?`.
- **Layout:** `grid-cols-1 md:grid-cols-12 gap-6`.

## BentoCard — `bento-card.tsx`

- **Fonte:** linhas 314–444 (cards individuais do bento).
- **Props:** `icon?`, `iconClassName?`, `title`, `description?`, `children?`, `colSpan?` (4/8/12), `className?`.
- **A11y:** headings `<h3>`; cor do ícone configurável pelo chamador (sem cor fixa no componente).

## Testimonials / TestimonialCard — `testimonials.tsx`, `testimonial-card.tsx`

- **Fonte:** linhas 454–547 (seção 6).
- **Testimonials props:** `id?`, `eyebrow?`, `headline?`, `subheadline?`, `items: TestimonialItem[]`, `className?`.
- **TestimonialItem/TestimonialCard props:** `quote`, `name`, `role?`, `initials?`, `avatarClassName?`, `className?`.
- **A11y:** citação em `<p>`; avatar com iniciais (não depende só de cor).

## FaqItem — `faq-item.tsx` (legado)

- **Fonte:** linhas 550–603 (seção 7 da versão antiga).
- **Props:** `question`, `answer`, `defaultOpen?`, `className?`.
- **A11y:** `<details>`/`<summary>` nativos, foco visível, `aria-hidden` no chevron.
- **Estado atual:** **não usado pela landing vigente**. A FAQ da rota `/` usa
  `Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionContent` de
  `src/components/shadcn/ui/accordion` (Radix), com chevron girando via
  `[&[data-state=open]>svg]:rotate-180`. Ver `src/marketing/pages.tsx`.

## CtaBanner — `cta-banner.tsx`

- **Fonte:** linhas 606–640 (seção 8).
- **Props:** `badge?`, `headline`, `subheadline?`, `primaryCta?`, `secondaryCta?`, `className?`.
- **CTAs:** primário → `/cadastro`, secundário → `/precos` (landing real).

## Showcase interativo (landing real, não extraído)

- `src/marketing/pages.tsx`: `role="tablist"` com 3 abas e roving tabindex
  (`tabIndex=0` só na ativa; ←/→/Home/End movem foco e seleção).
- Os 3 `role="tabpanel"` ficam sempre montados com `hidden={activeTab !== id}`
  para que `aria-controls` resolva e o estado interno dos demos seja preservado.
- Região `#operacoes` é o alvo do link "Operações" da navegação principal;
  `html { scroll-padding-top: 4rem }` evita sobreposição pelo header sticky.

## Não extraídos (fora do escopo desta tarefa)

- Navbar/Footer do template (linhas 30–107, 642–727): na landing vigente são
  internos a `src/marketing/pages.tsx` (a rota `/` **não** usa
  `MarketingLayout`, para evitar cabeçalho duplicado). `MarketingLayout`
  continua casca de `/precos` e `/termos`.
- PlanosSection — `PlanCard` já existente em `src/marketing/PlanCard.tsx`.
