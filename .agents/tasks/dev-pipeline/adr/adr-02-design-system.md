# ADR-02 — Design system: tokens, tema dark-default, fontes, shadcn/ui e componentes compartilhados

**Status:** proposto
**Escopo:** frontend (design system)
**Depende de:** ADR-01 (build com Tailwind `darkMode: "class"`, alias `@`, árvore de pastas).

## Contexto

O design doc (analysis-frontend §2) travou a direção visual ("painel de operação calmo":
superfícies ardósia/azul-noite, acento jade, tipografia geométrica) e os tokens com contraste
AA/AAA calculado. O dark mode é **padrão por requisito** (RF-SCAFF-08, CA-10). As telas-casca
(ADR-05) e os guards (ADR-04) dependem de um design system pronto: tokens, tema, primitivos
shadcn/ui e os compostos próprios (`StatusBadge`, `PlaceholderPanel`, `Logo`, sidebars,
`ThemeToggle`). Os enums de domínio (`AppointmentStatus`, `SubscriptionStatus`, `Role`) são
baratos e evitam strings mágicas nos badges — entram aqui porque o `StatusBadge` os consome.

## Decisão

1. **Dependências (versões fixadas):** `tailwindcss-animate`, `class-variance-authority`,
   `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, e os primitivos Radix que os
   componentes shadcn exigem. Fontes auto-hospedadas via `@fontsource/space-grotesk`,
   `@fontsource/inter`, `@fontsource/jetbrains-mono` (sem request externo em runtime — RNF01 /
   critério visual §8.8). **Sem Google Fonts por rede.**
2. **shadcn/ui:** `components.json` configurado (style, baseColor, alias `@/components`,
   `@/lib/utils`). Criar `src/lib/utils.ts` com `cn()`. Instalar os primitivos em
   `src/components/ui`: `button`, `card`, `input`, `label`, `badge`, `separator`, `sonner`,
   `dropdown-menu`, `avatar`, `sheet`, `skeleton`, `tooltip`. **Nunca recriar primitivo** —
   só os compostos próprios abaixo.
3. **Tokens de cor** (analysis-frontend §2.2) como CSS variables HSL em `src/index.css`:
   `:root` = tema claro de cortesia; `.dark` = tema padrão (background `222 24% 9%`,
   foreground `210 20% 96%`, primary jade `160 64% 45%`, destructive `0 72% 55%`, ring,
   border, card, muted-foreground, accent, `--radius: 0.75rem`). `tailwind.config.ts` mapeia
   esses tokens para as cores do tema (padrão shadcn via `hsl(var(--token))`) e registra as
   famílias de fonte (`font-sans` Inter, `font-display` Space Grotesk, `font-mono` JetBrains).
   Ligar `tabular-nums` no corpo para horários/valores.
4. **Dark mode por padrão:** `ThemeProvider` em `src/components/ThemeProvider.tsx` que aplica
   a classe `dark` no `<html>` por padrão, lê/escreve preferência em `localStorage`, e
   respeita `prefers-reduced-motion` nas transições. `ThemeToggle` (botão só-ícone com
   `aria-label` pt-BR) alterna e persiste. A app **inicia em dark** (CA-10).
5. **Enums de domínio** em `src/types` (ex.: `src/types/domain.ts`): `AppointmentStatus`
   (`pendente|confirmado|em_atendimento|concluido|cancelado|nao_compareceu`),
   `SubscriptionStatus` (`trial|ativo|pendente|bloqueado|cancelado`), `Role`
   (`super_admin|admin|professional|receptionist`). Valores conforme `dominio.md`.
6. **Componentes compartilhados próprios** em `src/components`:
   - `Logo` — marca com o "anel de confirmação" jade (analysis-frontend §2.5).
   - `StatusBadge` — recebe um `AppointmentStatus` e aplica o mapa de cores da tabela
     §2.2 (6 status, cores distintas); variante opcional para `SubscriptionStatus`. Labels
     em pt-BR.
   - `PlaceholderPanel` — casca "em construção" reutilizável (`titulo`/`descricao`), usada por
     todas as telas-casca da ADR-05.
   - `PageHeader`, `ThemeToggle` (acima), `ThemeProvider` (acima).
   - `AppSidebar` e `AdminSidebar` ficam na ADR-04 (fazem parte dos layouts) — aqui só os
     componentes de apresentação puros.
7. **Acessibilidade de base** (analysis-frontend §3): foco visível via `--ring` (nunca
   `outline:none` sem substituto), `aria-label` em botões só-ícone, labels associados. A
   validação completa com leitor de tela fica para QA manual.

Para provar o design system isoladamente, `src/App.tsx` (ainda sem rotas) renderiza uma
amostra: `Logo`, um `Button` shadcn, o `ThemeToggle` e os 6 `StatusBadge`. A ADR-05 substitui
isso pela casca real.

## Consequências

- Todas as telas-casca e guards das ADRs seguintes consomem tokens/compostos prontos, sem
  reabrir decisão visual nem recriar primitivos.
- Dark default + contraste AA/AAA + fontes locais ficam garantidos antes de existir conteúdo,
  então o critério visual (§8) é verificável incrementalmente.
- Enums de domínio centralizados evitam strings mágicas nos badges e guards (ADR-04).

## Arquivos afetados

- `package.json`, `package-lock.json` (novas deps fixadas)
- `components.json`, `src/lib/utils.ts`
- `src/index.css` (tokens + imports de fonte @fontsource), `tailwind.config.ts` (mapa de cores/fontes)
- `src/components/ui/*` (primitivos shadcn)
- `src/components/{ThemeProvider,ThemeToggle,Logo,StatusBadge,PlaceholderPanel,PageHeader}.tsx`
- `src/types/domain.ts`
- `src/App.tsx` (amostra temporária do design system)

## Critérios de aceite testáveis (desta ADR)

1. `npm run build` conclui sem erro de tipo. (CA-01)
2. `npm run dev`: a app inicia com `<html class="dark" lang="pt-BR">`; fundo ardósia (~`#11151C`),
   não preto puro nem branco. (CA-10/CA-11)
3. Pelo menos 1 componente shadcn renderiza com estilo aplicado. (RF-SCAFF-02)
4. `ThemeToggle` alterna dark/claro e persiste em `localStorage`; foco visível (anel jade) ao
   tabular. (critério visual §6)
5. `StatusBadge` exibe os 6 status do agendamento com cores distintas. (critério visual §7)
6. DevTools → Network: fontes carregam localmente (@fontsource), sem request a Google Fonts;
   nenhuma requisição a Supabase no load. (critério visual §8)
7. Textos visíveis em pt-BR. (CA-11)

## Verificação

- `cd <workdir> && npm run build` → limpo.
- QA (Chrome DevTools, pode ser "now" pois há superfície visual): dark default, amostra de
  badges, toggle persistente, fontes locais na aba Network, sem erro no console.
