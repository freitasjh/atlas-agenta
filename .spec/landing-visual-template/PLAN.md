# Troca visual da landing — fonte: template admin

**Fonte:** src/pages/LandingPage.tsx
**Alvo:** src/marketing/pages.tsx (rota "/")
**Conteúdo:** manter Atlas Agenda (CTAs /cadastro, /precos)

1. Migrar tokens HSL → oklch (tokens-shadcn.css) preservando status-*/service-*.
2. Atualizar tailwind.config.ts para tokens oklch e testes de contraste.
3. Substituir visual da landing pelo template: navbar, hero com showcase interativo, bento, pricing, testimonials, FAQ accordion, CTA banner, footer.
4. Ajustar router: "/" com layout do template; /precos e /termos mantidos no MarketingLayout.
5. Validar build/test e comparação visual browser.
