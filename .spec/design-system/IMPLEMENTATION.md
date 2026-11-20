# Implementação — Design System da Landing

Data: 2026-11-20. Branch: `refactor/landing-page`.

## Arquivos criados

- `src/components/marketing/hero.tsx`
- `src/components/marketing/social-proof.tsx`
- `src/components/marketing/bento-grid.tsx`
- `src/components/marketing/bento-card.tsx`
- `src/components/marketing/testimonials.tsx`
- `src/components/marketing/testimonial-card.tsx`
- `src/components/marketing/faq-item.tsx`
- `src/components/marketing/cta-banner.tsx`
- `src/components/marketing/index.ts` (barrel)
- Stories: `*.stories.tsx` para cada componente (layout fullscreen).
- Docs: `.spec/design-system/TOKENS.md`, `COMPONENTS.md`, `IMPLEMENTATION.md`.

## Arquivos alterados

- `src/marketing/pages.tsx` — `LandingPage` agora consome os componentes extraídos; `PrecosPage`/`TermosPage` inalterados.

## Verificação

- `npm run typecheck`: OK (0 erros).
- `npm run build`: OK.
- `npm test`: OK — 234 arquivos / 1663 testes passando.

## Fontes consultadas

- `src/pages/LandingPage.tsx` (fonte de verdade) — linhas citadas em `COMPONENTS.md`.
- `DESIGN.md` §2 (tokens semânticos).
- `tailwind.config.ts`, `src/index.css` (HSL).
- `.agents/rules/frontend-coding-standards.md` (React) — padrões.

## Notas

- Nenhuma dependência nova.
- Tailwind v3 + tokens HSL mantidos (sem oklch).
- Componentes usam `@/components/shadcn/ui/button` e `@/lib/cn`, consistentes com o template.
