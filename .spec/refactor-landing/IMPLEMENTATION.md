# Implementação — Refatoração Landing Page

> **SUPERADO em 2026-11-20 pela troca visual da landing pelo template admin.**
> Este registro descreve a primeira rodada (layout do template com casca
> `MarketingLayout` e FAQ nativa `<details>`). A implementação vigente está em
> `.spec/landing-visual-template/IMPLEMENTATION.md`: a rota `/` não usa mais
> `MarketingLayout` (navbar/footer internos, sem cabeçalho duplicado) e a FAQ
> usa o `Accordion` do template (Radix). Documentação mantenida apenas como
> histórico; não usar como especificação corrente.

**Branch:** `refactor/landing-page`
**Data:** 2026-11-20 (registro histórico)

## Arquivos alterados

- `src/marketing/pages.tsx` — `LandingPage` refatorada para seguir o layout do template admin (`src/pages/LandingPage.tsx`), mantendo `MarketingLayout` como casca **nesta rodada** (revogado depois: ver aviso no topo). Portadas: hero (chip + StatusBadge pendente→confirmado, headline/subheadline, CTAs, trust pills), social proof (logos), bento grid de recursos (5 cards), seção de planos (`PLANS` → `PlanCard preview` + link "Ver todos os planos"), depoimentos (3 cards), FAQ nativo (`<details>`/`<summary>`) estilizado **nesta rodada** (revogado: Accordion do template), banner CTA final (novo). `PrecosPage` e `TermosPage` mantidos.
- `src/components/shadcn/dashboard/data-table.tsx`, `src/components/shadcn/ui/data-table/data-table.tsx`, `src/components/shadcn/dashboard/chart-area-interactive.tsx` — correções de tipagem preexistentes (FlexRender bigint, `new Date(value)`) para `tsc -b` verde.

## CTAs avaliados

| Local | Texto | Destino | Tipo | Status |
|-------|-------|---------|------|--------|
| Hero | Começar agora | /cadastro | primária (lg) | mantido |
| Hero | Ver planos | /precos | secundária (outline, lg) | mantido |
| Planos | Ver todos os planos | /precos | outline | mantido |
| Banner CTA final (novo) | Começar agora | /cadastro | primária (lg, shadow-md) | criado |
| Banner CTA final (novo) | Ver planos | /precos | secundária (outline, lg) | criado |

## Novo CTA final

Banner CTA final (seção 8 do template): badge com ícone `Zap` + headline "Pronto para transformar a produtividade da sua equipe?" + subheadline + botão primário "Começar agora" → `/cadastro` + botão secundário "Ver planos" → `/precos`. Layout segue o template (badge `bg-primary/10`, headline `text-3xl…lg:text-5xl`, botão `lg` com `shadow-md`).

## Comandos executados e resultado

- `npm install` — OK (deps instaladas).
- `npm run typecheck` (`tsc -b`) — OK (0 erros).
- `npm run build` (`tsc -b && vite build`) — OK (build concluído).
- `npm test` (`vitest run`) — 234 arquivos de teste / 1663 testes passaram; 2 falhas preexistentes em `src/contrast-tokens.test.ts` e `src/lib/contrast.test.ts` (testes acoplados aos tokens HSL antigos de `src/index.css`), não causadas por esta mudança. **Resolvidas na rodada seguinte:** os testes passaram a ler `src/tokens-shadcn.css` e, em 2026-11-20, os valores `status-*`/`service-*` foram recalculados com HSL→sRGB→OKLab→OKLCH exato (ver `.spec/landing-visual-template/IMPLEMENTATION.md` §8).

## Portas

Nenhum servidor de dev iniciado; portas livres ao final.
