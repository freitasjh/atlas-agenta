# Análise de Frontend — Scaffold inicial do Atlas Agenda (recorte "b")

Papel: Designer dedicado de frontend do pipeline. Este documento é um **design doc de
frontend**, não código. O recorte é o **esqueleto navegável** (scaffold) do Atlas Agenda na
raiz do workspace, hoje greenfield (só existe `.kiro/`).

> Esta demanda TOCA tela: cria a casca navegável das quatro áreas (marketing, auth, app,
> admin) com placeholders. Logo, produzo o design completo abaixo. O que NÃO entra está
> explicitado na seção 7 para o planejador não transbordar escopo.

---

## 0. Decisão de stack (travada ao aprovar este doc)

SPA **React 18 + Vite 5 + TypeScript estrito** (`strict: true`, sem `any` implícito).
Estilo com **Tailwind CSS v3 + shadcn/ui** (Radix UI por baixo). Roteamento com
**React Router v6** (`createBrowserRouter`). Estado de servidor com **TanStack Query v5**
(`QueryClientProvider` no topo). Formulários com **react-hook-form + @hookform/resolvers + zod**
(entram como dependência já instalada; neste recorte não há formulário funcional, só o
scaffold de validação em `src/lib`). Cliente **Supabase (@supabase/supabase-js v2)** com
**anon key** via `import.meta.env.VITE_*`. Ícones **lucide-react**. Fontes auto-hospedadas via
**@fontsource** (sem request externo em runtime, ajuda RNF01).

Versões **fixadas** (sem `^`/`~`) e `package-lock.json` committado. `.env` no `.gitignore`;
`.env.example` versionado. **Nunca** service role no cliente.

Por que React Router "data router" (`createBrowserRouter`) e não o `<BrowserRouter>` clássico:
já deixa o terreno pronto para `loader`/guards por rota nas fases seguintes, sem reescrever a
árvore. Por que Vite e não Next: a spec/stack.md define SPA + Supabase BaaS; SSR não é
requisito e adicionaria custo/complexidade contra o objetivo "custo de infra próximo de zero".

---

## 1. Rotas, telas e guards

### 1.1 Mapa de rotas (recorte "b" = cascas com placeholder)

```
/                     marketing   Landing (hero + proposta de valor)        público
/precos               marketing   Planos (Individual/Clínica/Pro)           público
/termos               marketing   Termos & privacidade (LGPD)               público
/login                auth        Entrar                                    público
/cadastro             auth        Criar conta da empresa                    público
/recuperar-senha      auth        Recuperar senha                           público
/app                  app         Dashboard do tenant (shell + sidebar)     "autenticado"*
/app/agenda           app         Agenda (placeholder)                      *
/app/clientes         app         Clientes (placeholder)                    *
/app/cobrancas        app         Cobranças (placeholder)                   *
/app/config           app         Configurações (placeholder)              *
/admin                admin       Painel super admin (shell)                "super admin"*
/admin/empresas       admin       Empresas assinantes (placeholder)        *
*                     —           404 em pt-BR                              público
```

\* **Importante (limite de escopo):** neste recorte os guards são **stubs visuais sem lógica
de auth real**. Não há sessão Supabase sendo lida, não há RBAC efetivo, não há leitura de
`subscription_status`. O design abaixo descreve a **forma** do guard (onde ele mora, que
contrato terá) para que a Fase posterior só preencha a lógica — não a lógica em si.

Decisão `/app` vs `/dashboard`: uso **`/app`** como base do tenant (a spec aceita os dois;
fixo um para consistência). Rotas voltadas ao usuário em pt-BR onde fizer sentido
(`/precos`, `/cadastro`, `/recuperar-senha`); a base técnica do tenant fica `/app` e os
módulos em pt-BR (`/app/agenda`, `/app/clientes`, `/app/cobrancas`, `/app/config`).

### 1.2 Árvore de layouts (React Router `createBrowserRouter`)

```
RootLayout (ThemeProvider dark-default + QueryClientProvider + <Outlet/> + Toaster)
├── MarketingLayout  (header público + footer)        → /  /precos  /termos
├── AuthLayout       (card centralizado, split visual) → /login /cadastro /recuperar-senha
├── AppGuard (stub)  → AppLayout (sidebar + topbar)    → /app/*
└── AdminGuard(stub) → AdminLayout (sidebar admin)     → /admin/*
```

### 1.3 Contrato dos guards (forma, sem lógica nesta fase)

Projetar três componentes-casca em `src/app`/`src/admin` que no futuro receberão a lógica
descrita no steering (`ui-frontend`, `seguranca-multitenant`). Nesta fase renderizam direto o
`<Outlet/>` com um `TODO` comentado e, opcionalmente, um banner discreto "Área autenticada
(stub)". Contrato previsto:

- **`RequireAuth`** — futura: sem sessão Supabase → `redirect('/login')`. Hoje: passthrough.
- **`RequireRole(role[])`** — futura: deriva `role` de `profiles`; fora do papel → 403/redireciona.
  Hoje: passthrough. (`professional` só própria agenda; `receptionist` sem cobranças;
  `admin` tudo do tenant; `super_admin` só `/admin`.)
- **`RequireActiveSubscription`** — futura: lê `tenants.subscription_status`;
  `bloqueado` → redireciona para **tela de quitação** (`/app/quitacao`, a criar na fase de
  billing); `cancelado` → acesso suspenso. Hoje: passthrough.

Deixar esses três como arquivos nomeados evita que a fase de auth reorganize a árvore de rotas.
Nenhum deles lê `tenant_id` do cliente — o isolamento será sempre do RLS (reforço do
`seguranca-multitenant.md`).

---

## 2. Direção visual e design system

### 2.1 Conceito

Atlas Agenda é ferramenta de **trabalho diário no celular** para quem atende clientes (barbearia,
estética, clínica, consultório). O oposto de um dashboard corporativo frio. A direção é
**"painel de operação calmo"**: escuro por padrão (dark mode é default por requisito e descansa a
vista de quem usa o dia todo), com **um único acento quente** que marca ação e confirmação — a
cor do "confirmado", que é o coração do produto (reduzir no-show). Fujo dos três defaults de IA
(cream+serif+terracota; preto+verde-ácido; broadsheet com hairlines). Aqui: superfícies
**ardósia/azul-noite** (não preto puro), tipografia geométrica legível, e um verde-jade como
assinatura — remete a "confirmado/recebido", não a alerta.

### 2.2 Tokens de cor (CSS variables → Tailwind, padrão shadcn)

Definidos como HSL em `:root` (tema claro de cortesia) e `.dark` (tema padrão). Valores
escolhidos para contraste AA. shadcn/ui consome via `hsl(var(--token))`.

Dark (padrão) — superfície e texto:

| Token | HSL | Uso | Contraste |
| --- | --- | --- | --- |
| `--background` | `222 24% 9%` (#11151C) | fundo app | — |
| `--card` | `222 20% 13%` (#171C25) | cards/sidebar | — |
| `--foreground` | `210 20% 96%` (#F0F3F7) | texto primário | **14.8:1** sobre background ✅ AAA |
| `--muted-foreground` | `215 14% 66%` (#9BA6B4) | texto secundário | **6.3:1** sobre background ✅ AA |
| `--border` | `222 15% 22%` (#2E3542) | bordas/divisores | — |
| `--primary` | `160 64% 45%` (#2BBE8C jade) | ação/confirmado | texto `--primary-foreground` branco-escuro **5.1:1** ✅ AA |
| `--primary-foreground` | `160 40% 8%` | texto sobre primary | — |
| `--accent` | `222 18% 18%` | hover sutil | — |
| `--destructive` | `0 72% 55%` (#E0474A) | cancelar/erro | branco **4.7:1** ✅ AA |
| `--ring` | `160 64% 55%` | foco visível | — |

Claro (cortesia, não default): `--background 210 30% 99%`, `--foreground 222 30% 12%`
(contraste **15:1**), mesmo `--primary` jade. O toggle existe, mas a app **inicia no dark**.

Badges de status do agendamento (usados já como amostra visual no placeholder da agenda) —
mapa de cor por estado da máquina de estados do domínio:

| status | cor base | semântica |
| --- | --- | --- |
| `pendente` | âmbar `38 92% 55%` | aguardando confirmação |
| `confirmado` | jade (`--primary`) | assinatura do produto |
| `em_atendimento` | azul `210 90% 60%` | em curso |
| `concluido` | cinza-verde `160 20% 55%` | encerrado ok |
| `cancelado` | `--destructive` | cancelado |
| `nao_compareceu` | vinho `350 40% 45%` | no-show |

Status de assinatura (badge no admin/placeholder): `trial` azul, `ativo` jade, `pendente`
âmbar, `bloqueado` destructive, `cancelado` cinza.

### 2.3 Tipografia

- **Display/headings:** `Space Grotesk` (@fontsource) — geométrica com personalidade, boa em
  números (horários, preços) sem virar "serif de IA". Pesos 500/600.
- **Corpo/UI:** `Inter` (@fontsource) — leitura em telas pequenas, tabular-nums ligado para
  horários e valores R$ alinharem.
- **Mono (dados/código, copia-e-cola PIX no futuro):** `JetBrains Mono`.

Escala (mobile-first; `clamp` no display): h1 `clamp(1.75rem,5vw,2.75rem)/600`, h2 `1.5rem/600`,
h3 `1.125rem/600`, body `0.9375rem/400`, small `0.8125rem`, label `0.75rem/500` uppercase
tracking-wide.

### 2.4 Espaçamento, raios, sombra

Escala Tailwind padrão (base 4px). Raio: `--radius: 0.75rem` (cards e botões arredondados,
ar de app mobile moderno, não broadsheet). Sombra discreta só em overlays (dialog/popover);
superfícies planas diferenciadas por `--card` vs `--background`.

### 2.5 Assinatura visual

O **"anel de confirmação"**: um arco/halo jade sutil que aparece no logotipo do topo e como
accent nos estados `confirmado`. É o fio condutor que liga marca → ação → estado do
agendamento. No scaffold aparece no logo do header e na amostra de badge; vira linguagem nas
fases seguintes. Mantido com restrição (uma assinatura, não decoração espalhada).

### 2.6 Componentes shadcn/ui a instalar (reutilizar, nunca recriar)

Base do scaffold em `src/components/ui`: `button`, `card`, `input`, `label`, `badge`,
`separator`, `sonner` (toast), `dropdown-menu`, `avatar`, `sheet` (menu mobile), `skeleton`
(preparar RNF01), `tooltip`. Componentes compartilhados próprios em `src/components`:
`ThemeProvider`, `ThemeToggle`, `Logo` (com o anel), `AppSidebar`, `AdminSidebar`,
`PageHeader`, `PlaceholderPanel` (casca "em construção" reutilizável), `StatusBadge`
(mapa de cores da 2.2). **Nenhum primitivo shadcn é recriado** — só compostos.

---

## 3. Acessibilidade

- **Contraste:** valores calculados na tabela 2.2 — texto primário 14.8:1 (AAA), secundário
  6.3:1 (AA), primary/destructive sobre seus foregrounds ≥ 4.5:1 (AA). Metas AA cumpridas;
  validação completa com leitor de tela fica para QA manual.
- **Foco visível:** `--ring` jade com `outline`/`ring-2 ring-offset-2` em todo elemento
  focável; nunca `outline: none` sem substituto. shadcn já entrega isso — não quebrar.
- **Teclado:** navegação por Tab em header, sidebar e toggle de tema; `Sheet` mobile fecha no
  `Esc` e devolve foco ao gatilho (Radix cuida). Skip-link "Pular para o conteúdo" no
  `RootLayout`.
- **Labels/semântica:** `<label htmlFor>` em qualquer input de placeholder; landmarks
  `header`/`nav`/`main`/`footer`; `aria-current="page"` no item ativo da sidebar;
  `aria-label` em botões só-ícone (toggle de tema, menu).
- **Movimento:** respeitar `prefers-reduced-motion` em qualquer transição.
- **Idioma:** `<html lang="pt-BR">`.

---

## 4. Arquitetura React

- **Composição:** páginas finas; a casca de cada área vive no Layout. `PlaceholderPanel`
  recebe `titulo`/`descricao` e padroniza as telas-casca (evita 11 placeholders divergentes).
- **Estado de servidor:** `QueryClientProvider` montado no `RootLayout` com um `QueryClient`
  configurado (`staleTime` sensato, `retry` moderado) em `src/lib/queryClient.ts`. Neste
  recorte não há query real; o provider fica montado e pronto (critério de aceite). **Nada de
  `fetch` solto em `useEffect`** — regra para as fases seguintes, reforçada aqui.
- **Hooks de dados:** pasta `src/hooks` criada com um exemplo documentado (comentado) do
  padrão `useQuery`, sem chamada real. Acesso a dados sempre centralizado em `src/lib` + hooks.
- **Cliente Supabase:** `src/lib/supabase.ts` cria o client com `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY` validados por **zod** na borda (falha explícita em dev se faltar
  env, mensagem pt-BR no console). **Só anon key** no cliente; RLS isola; **nunca** enviar
  `tenant_id` do cliente para contornar RLS; service role jamais no bundle.
- **Validação/formulários:** `src/lib/validations/` com um schema zod de exemplo (ex.: login)
  **sem** submit funcional — prepara react-hook-form + resolver para a fase de auth.
- **Tipos:** `src/types` com enums de domínio já tipados (`AppointmentStatus`,
  `SubscriptionStatus`, `Role`) para os badges e guards consumirem — barato e evita strings
  mágicas.

Estrutura final de pastas (conforme stack.md):

```
src/{app,admin,marketing,auth,components,components/ui,lib,lib/validations,hooks,types}
supabase/{migrations,functions}   # vazios (placeholder .gitkeep)
```

---

## 5. Dependências de dados ausentes (sinalização)

Fora deste recorte por decisão de escopo; **bloqueiam** as próximas fases e devem virar ADRs:

- **Migrations/RLS:** `tenants`, `profiles`, `appointments`, `customers`, `services`,
  `charges`, etc. — nenhuma tabela/política criada agora. Guards e hooks dependem de
  `profiles.role` e `tenants.subscription_status` que ainda não existem.
- **Supabase Auth:** sessão/login real — ausente; os guards são stubs.
- **Edge Functions:** webhooks Asaas / disparos Evolution — ausentes.
- **Projeto Supabase provisionado:** as `VITE_*` em `.env.example` ficam como placeholder; o
  app deve subir e buildar mesmo sem backend real (o client não conecta em runtime no scaffold).

---

## 6. Critérios de aceite visual (verificáveis — QA por ADR via Chrome DevTools)

1. `npm install` + `npm run build` concluem sem erro; `npm run dev` serve a SPA.
2. `<html>` inicia com classe `dark` e `lang="pt-BR"`; fundo é a ardósia `#11151C`, não preto
   puro nem branco.
3. Navegar por `/`, `/precos`, `/termos`, `/login`, `/cadastro`, `/recuperar-senha`, `/app`,
   `/app/agenda`, `/app/clientes`, `/app/cobrancas`, `/app/config`, `/admin`, `/admin/empresas`
   renderiza a casca certa **sem erro no console**.
4. URL inexistente renderiza 404 em pt-BR.
5. Em 375px de largura (mobile) a sidebar do `/app` vira `Sheet` acionado por botão de menu
   acessível; em ≥768px a sidebar fica fixa. Nada estoura horizontalmente (sem scroll-x).
6. Toggle de tema alterna dark/claro e persiste (localStorage); foco visível (anel jade) ao
   tabular pelos controles do header.
7. A amostra de `StatusBadge` na casca da agenda mostra os seis status com as cores da tabela 2.2.
8. DevTools → Network: fontes carregam localmente (@fontsource), sem request externo a Google
   Fonts; nenhuma requisição a Supabase dispara no load do scaffold.
9. Todo texto visível em pt-BR (inclusive 404 e labels).

---

## 7. Fora de escopo (para o planejador não transbordar)

- Sem migration/schema/RLS. Sem login funcional. Sem RBAC real (só stubs). Sem leitura de
  `subscription_status`. Sem telas reais de negócio (agenda/clientes/cobranças são
  `PlaceholderPanel`). Sem Edge Functions. Sem integração Asaas/Evolution.
- Tela de quitação (`bloqueado`) é só citada no contrato do guard; não é construída agora.

---

## 8. Observações finais

Design é a casca madura o suficiente para que cada fase seguinte (auth, agenda, cobranças,
admin) encaixe sem reorganizar rotas, tema ou design system. A disciplina aqui é: tokens e
layouts prontos e corretos, lógica de negócio **ausente por decisão**, limites de segurança
(anon key, sem `tenant_id` do cliente, service role fora do bundle) já refletidos na forma do
código mesmo sem backend.
