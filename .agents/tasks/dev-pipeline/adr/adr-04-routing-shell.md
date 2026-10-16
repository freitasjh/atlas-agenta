# ADR-04 — Casca de roteamento: React Router data router, layouts, providers na raiz e stubs de guard

**Status:** proposto
**Escopo:** frontend (roteamento + layouts)
**Depende de:** ADR-02 (tema/providers/componentes: `ThemeProvider`, `ThemeToggle`, `Logo`,
sidebars-base) e ADR-03 (`QueryClient` para o provider na raiz). Vem antes da ADR-05, que
preenche o conteúdo das rotas.

## Contexto

A casca navegável precisa das quatro áreas (marketing, auth, app do tenant, admin) separadas
em rotas, com layouts por área e um 404 em pt-BR (analysis-frontend §1). Os guards
(`RequireAuth`, `RequireRole`, `RequireActiveSubscription`) existem **como stubs passthrough
nomeados**, sem lógica de auth — só a forma, para a fase de auth preencher sem reorganizar a
árvore (PRD §2.2, analysis-frontend §1.3). A raiz monta `ThemeProvider` (dark default),
`QueryClientProvider` e o `Toaster` (sonner). Decisão travada: base do tenant é **`/app`** (a
spec aceitava `/app` ou `/dashboard`); usar `createBrowserRouter` (data router) para deixar o
terreno pronto para `loader`/guards por rota sem reescrever a árvore.

## Decisão

1. **Dependência (fixada):** `react-router-dom` v6.
2. **Roteador** em `src/router.tsx` com `createBrowserRouter`. A raiz `RootLayout`
   (`src/components/RootLayout.tsx` ou `src/App.tsx` reescrito) monta: `ThemeProvider`
   (dark default, da ADR-02) → `QueryClientProvider` (QueryClient da ADR-03) → skip-link
   "Pular para o conteúdo" → `<Outlet/>` → `Toaster` (sonner). `<main id="conteudo">` como
   landmark para o skip-link.
3. **Layouts por área** (landmarks `header`/`nav`/`main`/`footer`, mobile-first):
   - `MarketingLayout` (`src/marketing/`) — header público (com `Logo` + `ThemeToggle`) + footer.
   - `AuthLayout` (`src/auth/`) — card centralizado, split visual.
   - `AppLayout` (`src/app/`) — `AppSidebar` + topbar; em ≥768px sidebar fixa, em mobile vira
     `Sheet` acionado por botão de menu acessível (`aria-label` pt-BR). `aria-current="page"`
     no item ativo.
   - `AdminLayout` (`src/admin/`) — `AdminSidebar` + topbar, mesmo padrão responsivo.
   - `AppSidebar`/`AdminSidebar` são criados aqui (compõem os primitivos shadcn da ADR-02).
4. **Stubs de guard** (passthrough, sem lógica — contratos nomeados, analysis-frontend §1.3):
   - `src/app/guards/RequireAuth.tsx` — hoje renderiza `<Outlet/>` com `// TODO` (futuro:
     sem sessão → `redirect('/login')`).
   - `src/app/guards/RequireRole.tsx` — recebe `roles: Role[]` (tipo da ADR-02), hoje
     passthrough (futuro: deriva `role` de `profiles`).
   - `src/app/guards/RequireActiveSubscription.tsx` — hoje passthrough (futuro: lê
     `tenants.subscription_status`; `bloqueado` → tela de quitação). **Nenhum guard lê ou
     envia `tenant_id` do cliente** — isolamento é sempre do RLS (PRD §4 item 2). Um banner
     discreto "Área autenticada (stub)" é opcional.
5. **Árvore de rotas** (conteúdo placeholder vem na ADR-05 via `PlaceholderPanel`; aqui as
   rotas apontam para componentes ainda mínimos/placeholder):
   - `/`, `/precos`, `/termos` sob `MarketingLayout`.
   - `/login`, `/cadastro`, `/recuperar-senha` sob `AuthLayout`.
   - `/app` → `RequireAuth` → `RequireActiveSubscription` → `AppLayout`, com filhos
     `agenda`, `clientes`, `cobrancas`, `config`.
   - `/admin` → `RequireAuth` → `RequireRole(['super_admin'])` → `AdminLayout`, com filho
     `empresas`.
   - **Rota curinga `*` → 404 em pt-BR** (`src/components/NotFound.tsx`): mensagem clara em
     pt-BR + link para `/`.

## Consequências

- A SPA passa a ser navegável de ponta a ponta entre as quatro áreas, com 404 pt-BR.
- Guards existem como forma estável: a fase de auth preenche a lógica sem mexer na árvore de
  rotas nem nos layouts.
- Data router (`createBrowserRouter`) deixa `loader`/`action` disponíveis para as fases
  seguintes sem reescrita.

## Arquivos afetados

- `package.json`, `package-lock.json` (react-router-dom fixado)
- `src/main.tsx` (usa `RouterProvider`), `src/router.tsx`
- `src/components/RootLayout.tsx`, `src/components/NotFound.tsx`
- `src/components/AppSidebar.tsx`, `src/components/AdminSidebar.tsx`
- `src/marketing/MarketingLayout.tsx`, `src/auth/AuthLayout.tsx`,
  `src/app/AppLayout.tsx`, `src/admin/AdminLayout.tsx`
- `src/app/guards/{RequireAuth,RequireRole,RequireActiveSubscription}.tsx`
- Remoção da amostra temporária de design system do `src/App.tsx` (migra para RootLayout/rotas)

## Critérios de aceite testáveis (desta ADR)

1. `npm run build` conclui sem erro de tipo. (CA-01)
2. `QueryClientProvider` montado na raiz; sem erro de contexto do TanStack Query em runtime.
   (CA-08/RF-SCAFF-07)
3. Navegar por `/`, `/precos`, `/termos`, `/login`, `/cadastro`, `/recuperar-senha`, `/app`,
   `/app/agenda`, `/app/clientes`, `/app/cobrancas`, `/app/config`, `/admin`,
   `/admin/empresas` renderiza o layout da área sem erro no console. (CA-03..CA-06)
4. URL inexistente renderiza **404 em pt-BR**. (CA-07)
5. Em 375px a sidebar do `/app` vira `Sheet` acionado por botão de menu acessível; em ≥768px
   fica fixa; nada estoura horizontalmente. (RNF-SCAFF-03, critério visual §5)
6. Os três guards existem como componentes passthrough nomeados; nenhum lê/envia `tenant_id`.
   (PRD §4 item 2)

## Verificação

- `cd <workdir> && npm run build` → limpo.
- QA (Chrome DevTools, pode ser "now"): navegar a todas as rotas sem erro no console, checar
  404 pt-BR, responsividade da sidebar em 375px vs ≥768px.
