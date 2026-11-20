# Refatoração — Landing Page (Atlas Admin Template)

**Branch:** `refactor/landing-page`
**Data:** 2026-11-20
**Alvo real:** `src/marketing/pages.tsx` (LandingPage + PrecosPage + TermosPage)
**Template de referência:** `src/pages/LandingPage.tsx` (+ stories)
**Layout admin:** `src/layouts/AtlasAdminLayout.tsx`, `DESIGN.md`

## Objetivo

Refatorar a landing page do produto para seguir o layout do template admin
(`src/pages/LandingPage.tsx`): navbar, hero com CTA, bento grid de recursos,
pricing, testimonials, FAQ, banner CTA final, footer. Avaliar CTAs existentes e
criar um novo CTA final no padrão do template.

## CTAs existentes (avaliação)

- `src/marketing/pages.tsx`: "Começar agora" → /cadastro (primária), "Ver planos" → /precos (secundária).
- Template (`src/pages/LandingPage.tsx`): "Experimentar Gratuitamente" → #/signup,
  "Fazer Login no Workspace" → #/login, "Acessar Plataforma Atlas" → #/shadcn (hero e banner final).

## Novo CTA (a criar)

Banner CTA final seguindo o layout do template (seção 8): badge + headline +
subheadline + botão primário "Acessar Plataforma Atlas" → /cadastro (ou /app quando autenticado).

## Restrições

- Não quebrar rotas "/", "/precos", "/termos" nem testes.
- Tokens semânticos (zero hex/cores fixas para estrutura).
- Sem novas dependências.
- Build (tsc + vite) e testes verdes.
- Code review obrigatório.

## Critério de aceite

- `npm run build` e `npm test` verdes.
- Landing em "/" renderiza hero + CTAs + seções no padrão do template.
- Console sem [ERROR]/[WARN] (H3).
- Code review sem 🔴.
