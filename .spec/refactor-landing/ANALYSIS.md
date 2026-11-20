# Análise — Template de Landing Page do Atlas Admin

**Fonte:** `src/pages/LandingPage.tsx` (Storybook `Pages/LandingPage`)

## Estrutura (9 seções)

1. Navbar superior (sticky): logo "Atlas", badge v2.0 Enterprise, nav links (Recursos, Operações, Planos & Preços, Casos de Sucesso, FAQ), ModeToggle, botões "Entrar" e "Acessar Plataforma" (CTA primário).
2. Hero: badge "Novidade", headline, subheadline, CTAs "Experimentar Gratuitamente" (primário) + "Fazer Login no Workspace" (secundário), trust pills, showcase interativo (KPI/Scheduler/Kanban).
3. Social proof: logos de empresas.
4. Bento grid de recursos (5 cards).
5. Pricing (PricingTable).
6. Testimonials (3 cards).
7. FAQ (Accordion).
8. Banner CTA final: badge + headline + subheadline + botão "Acessar Plataforma Atlas".
9. Footer completo (4 colunas + barra inferior).

## CTAs identificados

| Local | Texto | Destino (hash) | Tipo |
|-------|-------|----------------|------|
| Navbar | Acessar Plataforma | #/shadcn | primário (sm) |
| Hero | Experimentar Gratuitamente | #/signup | primário (lg) |
| Hero | Fazer Login no Workspace | #/login | secundário (outline, lg) |
| Banner final | Acessar Plataforma Atlas | #/shadcn | primário (lg) |
| Footer | Dashboard/Login/Cadastrar | #/shadcn, #/login, #/signup | links |

## CTAs da landing real (src/marketing/pages.tsx)

| Local | Texto | Destino | Tipo |
|-------|-------|---------|------|
| Hero | Começar agora | /cadastro | primária (lg) |
| Hero | Ver planos | /precos | secundária (outline, lg) |

## Gaps / adaptações necessárias

- Template usa hash router (`#/signup` etc.); landing real usa React Router (`/cadastro`, `/precos`, `/login`).
- Template é full-page (navbar/footer próprios); landing real usa `MarketingLayout`. Decisão: adaptar seções do template dentro da landing real, mantendo `MarketingLayout` para evitar duplicação de header/footer, OU tornar a landing full-bleed. Recomendação: manter `MarketingLayout` e portar apenas as seções de conteúdo (hero, bento, pricing, testimonials, FAQ, banner CTA final), reutilizando CTAs React Router.
- Showcase interativo do template (KPI/Scheduler/Kanban) depende de componentes existentes (`SectionCards`, `Scheduler`, `KanbanBoard`) — disponíveis em src/components/shadcn.
- Pricing usa `PricingTable` (src/components/shadcn/pricing/pricing-table) em vez de `PlanCard`/`PLANS`. A landing real usa `PlanCard` + `PLANS`. Manter consistência de preço: usar `PLANS`/`PlanCard` (ADR-01/03) para não duplicar valores.
- Trust pills e social proof podem ser portados.
- FAQ do template usa `Accordion` (Radix) em vez de `<details>` nativo. A landing real usa `<details>` nativo por decisão travada (ADR-06). Manter `<details>` nativo para acessibilidade/teclado, mas estilizar como template (card, bordas).
- Banner CTA final (seção 8) é o "novo CTA" a criar, seguindo layout do template.

## Novo CTA a criar

Banner CTA final (seção 8 do template): badge com ícone Zap + headline "Pronto para transformar a produtividade da sua equipe?" + subheadline + botão primário "Começar agora" → /cadastro, opcionalmente botão secundário "Ver planos" → /precos.
