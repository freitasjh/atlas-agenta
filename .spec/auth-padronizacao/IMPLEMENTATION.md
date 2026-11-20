# IMPLEMENTATION — padronização do fluxo de autenticação

Branch `refactor/auth-padronizacao`. Data: 2026-11-20. Análise: `ANALYSIS.md`.

## 1. O que mudou (diff resumo)

13 arquivos modificados + 9 novos. Total: **+297 / −513 linhas** nos arquivos
existentes (componentes mock antigos removidos).

### Novos primitivos (`src/components/shadcn/auth/`)
- `auth-card.tsx` — `AuthCard`: card com rim light (`span` 1px
  `via-foreground/15` / `dark:via-white/20`), `rounded-2xl`, `border-border/70`,
  `bg-card`, `shadow-xs`. Sem padding próprio; páginas mantêm
  `CardHeader`/`CardContent`/`CardFooter`. Tokens OKLCH, zero hex/rgb.
- `auth-shell.tsx` — `AuthShell`: `grid min-h-svh lg:grid-cols-2`, `ModeToggle`
  absoluto, logo via `Link to="/"`, `<Outlet/>` em `max-w-md` e capa temática
  (`BrandIllustration` + anéis `border-primary/10` + headline + highlights).
  Sem `<img src="/login-cover.svg">` (asset inexistente no repo).
- `auth.test.tsx` — 7 testes (links, notice/alert + ref, submit validado,
  pending/disabled, erro de campo, shell, card).
- `auth-card.stories.tsx`, `login-form.stories.tsx`, `signup-form.stories.tsx`
  — stories por estado, escritas antes das páginas consumidoras.
- `index.ts` reexporta `AuthCard`, `AuthShell`, `LoginForm`/`SignupForm` e tipos.

### Componentes adaptados
- `login-form.tsx` — de estático para controlado: recebe
  `form: UseFormReturn<LoginInput>`, `onSubmit(values)`, `isPending`, `disabled`,
  `notice`, `error`, `errorRef`. Campos via `form.register`, erros via
  `FieldError` (`role="alert"` + `aria-invalid`/`aria-describedby`), links
  `<Link to="/recuperar-senha">` e `<Link to="/cadastro">`, loading com
  `Loader2 aria-hidden`. **Removidos**: GitHub mock, `href="#"`, `#/signup`.
  Nota técnica: usa `Input` de `@/components/ui` (forwardRef) — o primitivo
  `@/components/shadcn/ui/input` não repassa ref e RHF não registra o campo.
- `signup-form.tsx` — de mock com `setTimeout`/`toast`/hash para shell
  controlado: `onSubmit`, `children`, `title`, `description`, `notice`, `error`,
  `errorRef`, `isPending`, `disabled`, `footer`. **Removidos**: estado local,
  `setTimeout(700)`, toast fake, `window.location.hash`, login social, links
  `href="#"` de termos. `children` permite o wizard rico real sem perder campo.
  Wrapper de `disabled` é `<div aria-disabled>` — não um `<fieldset>` — para não
  quebrar os testes que fixam exatamente 4 fieldsets no cadastro.

### Páginas reais (`src/auth/`)
- `LoginPage.tsx` — 131 → ~75 linhas. RHF/zod, `useSignIn`,
  `usePostLoginRedirect` e `mapAuthError` intactos; `role=status`/`role=alert`
  e foco via `errorRef` agora renderizados pelo `LoginForm`.
- `CadastroPage.tsx` — casca trocada para `AuthCard` + `SignupForm`; **todo o
  wizard preservado** (15 campos, 4 fieldsets, máscaras, ViaCEP, stepper,
  error-summary, `state.notice`, redirects). `name={field.name}` adicionado aos
  dois `Select` (Radix) para eliminar issue do Chrome sobre campos sem nome.
- `RecuperarSenhaPage.tsx`, `RedefinirSenhaPage.tsx`, `TrocarSenhaPage.tsx` —
  só o `<Card>` externo virou `AuthCard` (rim light). Lógica, toasts reais e
  `TROCAR_SENHA_COPY` intactos.
- `AuthLayout.tsx` / `GateLayout.tsx` — delegam para `AuthShell`; troca de senha
  passa a ter o mesmo visual das demais (grid/capa/ModeToggle).
- `mode-toggle.tsx` — `min-h-11 min-w-11` (alvo ≥44px, WCAG 2.1 AA).

### Templates (`src/pages/`)
- `LoginPage.tsx` — usa a nova API controlada de `LoginForm`; brand link virou
  `<Link to="/login">`.
- `SignupPage.tsx` — brand link virou `<Link to="/">`; callbacks mock
  (`#/login`, `#/shadcn`) substituídos por no-ops documentados (template visual).
- `LoginPage.stories.tsx` / `SignupPage.stories.tsx` — decorator `MemoryRouter`
  adicionado (os templates agora usam `<Link>`, que exige contexto de rota).

## 2. Decisões (ver ANALYSIS.md §3)

- **Cadastro não virou o form de 5 campos.** O template de referência usa
  `SignupWizardCard`; o cadastro real tem 15 campos em 4 etapas e testes que
  travam esse DOM. `SignupForm` virou shell para que a página real o consuma sem
  perder nada.
- **Capa sem asset quebrado.** `/login-cover.svg` não existe; usei
  `BrandIllustration` + tokens (theme-aware, sem hex).
- **Social login removido** nas duas bases (era mock e não há provedor real).

## 3. Validação

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ 0 erros |
| `npm run build` | ✅ build em 10,59s (warning pré-existente de chunk >500 kB) |
| `npm test` | ✅ **239 arquivos / 1702 testes, 0 falhas** |
| `npx oxlint <arquivos alterados>` | ✅ 0 achados |
| `bash scripts/verify.sh` (DESIGN.md §8) | ⚠️ script **não existe** no repo; substituído por typecheck + oxlint (acima). `scripts/build-tokens.mjs` também ausente — pendência de doc, não de código. |

### Testes novos/foco
- `src/components/shadcn/auth/auth.test.tsx` — 7 testes, estados
  default/loading/error/notice/disabled + submit e links.
- Foco de regressão (verdes): `LoginPage.notice.test.tsx` (3),
  `CadastroPage.signup.test.tsx` (5), `CadastroPage.rico.test.tsx` (19),
  `ModeToggle`, `TrocarSenhaPage.copy/guard`, `router.test.ts`.

### H3 — browser (dev server 127.0.0.1:5188, Chrome via chrome-devtools)
- `/login`: snapshot com `heading "Entrar na sua conta"`, links reais
  `/recuperar-senha` e `/cadastro`, `complementary "Apresentação do Atlas Agenda"`.
- Screenshots light/dark: `harness/auth-light.png`, `harness/auth-dark.png`.
- `/cadastro`: snapshot com stepper e 4 etapas; screenshot `harness/cadastro-light.png`.
- `/recuperar-senha`: snapshot com heading e link de volta ao login.
- Console: 0 `[ERROR]`, 0 `[WARN]`; apenas `[debug] [vite]` e `[info] React DevTools`.
  Issue do Chrome "form field sem id/name" corrigida com `name` nos `Select`.
- Network: 534 requisições, todas HTTP 200; nenhum 4xx/5xx e nenhum
  `/login-cover.svg` 404.
- Encerramento H5: `lsof -ti :5188` → PID 1693323 (vite) e 1695604 (Chrome
  network service) → `kill 1693323` → porta livre. `close_page` do browser.

### H1 / H4 / H6
- H1: suite completa rodada antes e depois da mudança (1702 testes).
- H4: a11y — alvo ≥44px no `ModeToggle`, `aria-hidden` em ícones/rim/capa,
  `role=status`/`alert`, `aria-invalid`, foco no erro; tokens OKLCH sem hex;
  responsividade 375px (layout empilhado) e 1280px (split 50/50) verificadas
  via snapshot/screenshot.
- H6: falta code review + `brain_store` + `workflow-state.json` pelo
  orquestrador (fora do escopo deste subagente de implementação).

## 4. Fontes consultadas (deepsearch — URL + data)

- https://react-hook-form.com/docs/useform/handlesubmit — 2026-11-20
  (`handleSubmit(onValid, onInvalid?)`; disable while pending).
- https://react-hook-form.com/docs/useform — 2026-11-20
  (`aria-invalid` + `<p role="alert">` para erro de campo).
- https://react-hook-form.com/docs/formprovider — 2026-11-20
  (`<FormProvider {...methods}>`; `useForm` completo na página).
- https://reactrouter.com/6.28.0/components/link — 2026-11-20
  (`LinkProps` omite `href`, exige `to`, renderiza `<a>` acessível).
- `DESIGN.md` local (§2 tokens OKLCH, §5.4 ícones, Arquétipo 5) — 2026-11-20.

## 5. Pendências / riscos residuais

- `DESIGN.md` §8 cita `scripts/verify.sh` e `build-tokens.mjs`, ausentes no repo:
  corrigir documentação do gate (fora desta task).
- `SignupPage.tsx` (template não roteado) mantém `SignupWizardCard` com
  callbacks no-op; se um dia for roteado, deve delegar a `CadastroPage`.
- Nenhuma dependência nova. Anti-enumeração (`mapAuthError`, `NEUTRAL_MESSAGE`,
  `state.notice`) e rotas inalteradas.
