# ANALYSIS — padronização do fluxo de autenticação

Branch: `refactor/auth-padronizacao`. Data: 2026-11-20.

## 1. Objetivo

Padronizar login, cadastro, recuperação, redefinição e troca de senha nos
componentes base `src/components/shadcn/auth/`, usando `src/pages/LoginPage.tsx`
e `src/pages/SignupPage.tsx` como referência visual, **sem alterar** a lógica
real de auth (RHF + zod, Supabase, redirects, anti-enumeração, a11y).

## 2. Estado atual — o que é template (mock) e o que é real

### 2.1 Componentes base `src/components/shadcn/auth/`

| Arquivo | Estado hoje | Classificação |
|---|---|---|
| `login-form.tsx` | Form estático. Sem RHF/zod. `href="#"` (esqueceu senha), `href="#/signup"` (criar conta), botão social GitHub com SVG inline, `required` nativo. | **Mock/template**. Não é usado por nenhuma rota do `router.tsx`. |
| `signup-form.tsx` | Estado local + `setTimeout(700)` + `toast.success` + `window.location.hash = "#/shadcn"`. Botão social GitHub com hash `#/shadcn`. Links `href="#"` (termos) e `#/login`. | **Mock/template**. Não é usado por nenhuma rota. |
| `index.ts` | Reexporta os dois e faz `export *` de `../signup` e `../mfa`. | Barrel a manter. |

### 2.2 Páginas template `src/pages/`

| Arquivo | Papel |
|---|---|
| `LoginPage.tsx` | **Referência visual**. Shell `grid min-h-svh lg:grid-cols-2`, `ModeToggle` absoluto no topo direito, coluna esquerda com logo + card `rounded-2xl border-border/70 bg-card` com rim light (`span` 1px no topo), coluna direita `hidden bg-muted lg:block` com `<img src="/login-cover.svg">`. Usa `LoginForm` com `onSubmit` que só seta hash `#/shadcn`. |
| `SignupPage.tsx` | **Referência visual**. Mesmo shell; card com rim light; usa `SignupWizardCard` (de `src/components/shadcn/signup`), **não** `SignupForm`. Overlay de depoimento/métricas na capa. |
| `*.stories.tsx` | Stories Light/Dark já existem para ambos os templates. |

**Achego relevante:** `public/login-cover.svg` **não existe** no repositório (só `favicon.svg`). O `<img>` do template aponta para asset ausente. Decisão abaixo (§4.3).

### 2.3 Páginas reais `src/auth/` (rotas do `router.tsx`)

| Rota | Arquivo | Lógica real (preservar) |
|---|---|---|
| `/login` | `LoginPage.tsx` | `useSignIn`, `usePostLoginRedirect`, `readNoticeState(location.state)`, `mapAuthError`, `role="status"` (notice) e `role="alert"` (erro) com foco via ref. Anti-enumeração: mensagem genérica do catálogo. |
| `/cadastro` | `CadastroPage.tsx` | Wizard de 4 etapas (Empresa → Endereço → Acesso → Responsável), 15 campos, `signupSchema`/zod, máscaras, ViaCEP (`useCepLookup`), `useSignUp`, `usePostLoginRedirect`, `navigate('/login', {state:{notice}})` quando auto-login falha, error-summary com âncoras, `role="alert"`. Submissão atômica à Edge Function `signup-tenant`. |
| `/recuperar-senha` | `RecuperarSenhaPage.tsx` | `requestResetSchema`, `useRequestPasswordReset`, mensagem neutra **sempre** (anti-enumeração), `role="status"` no estado "enviado". |
| `/redefinir-senha` | `RedefinirSenhaPage.tsx` | `resetPasswordSchema`, sessão `PASSWORD_RECOVERY`, `useUpdatePassword`, toast + `navigate('/app')`, estados loading/inválido/erro. |
| `/trocar-senha` | `TrocarSenhaPage.tsx` | Sob `GateLayout` + `RequireAuth`, fora do guard de troca. `initialPasswordSchema`, `useChangeInitialPassword`, `submittingRef`, re-login quando claims仍 com flag, `TROCAR_SENHA_COPY` (teste de cópia). |

Layouts: `AuthLayout.tsx` (split com `aside` + `BrandIllustration` + `ThemeToggle`),
`GateLayout.tsx` (coluna única, sem capa). Ambos usam `Logo`, `ThemeToggle` e
`min-h-screen`.

### 2.4 Testes que fixam contrato (não podem quebrar)

- `LoginPage.notice.test.tsx`: `getByRole("status")` com o texto exato do notice;
  `queryByRole("status")` **null** quando não há notice (inclusive notice não-string).
- `CadastroPage.signup.test.tsx`: costura com `useSignUp`/`usePostLoginRedirect`,
  valores normalizados pelo zod enviados à mutation, `findByRole("alert")` com
  texto exato do catálogo de erro, `LoginProbe` lendo `location.state`.
- `CadastroPage.rico.test.tsx`: 4 `fieldset` + `legend`, ids `cadastro-*`, 3+
  grids `.sm:grid-cols-2`, **1** `button[type=submit]`, error-summary com
  `role="alert"` e foco, máscaras, ViaCEP, stepper `nav[aria-label="Etapas do cadastro"]`.
- `TrocarSenhaPage.copy.test.ts` / `guard.test.ts`: mapa de cópia e helpers puros.

## 3. Incompatibilidade central e decisão

O `SignupForm` base tem 5 campos (nome, e-mail, senha, confirmação, termos) e
`setTimeout` mock. O cadastro real tem **15 campos em 4 etapas**, máscaras,
ViaCEP e submissão atômica. Não há mapeamento 1:1 — e o próprio template de
referência (`pages/SignupPage.tsx`) usa `SignupWizardCard`, não `SignupForm`.

**Decisão:** adaptar `SignupForm` como **shell de apresentação controlada**
(cabeçalho, feedback `role=status`/`alert`, `<form>`, rodapé) que aceita
`children` com os campos reais. Assim o `CadastroPage` consome o componente base
sem perder um único campo, validação, máscara ou redirect. O mesmo padrão vale
para `LoginForm`: recebe a instância `UseFormReturn<LoginInput>` da página e
renderiza os campos com `register` + `FieldError`, mantendo RHF/zod na página.

Nada de `setTimeout`, `toast` mock, hash `#/...` ou login social sobrevive nas
rotas reais. Links passam a ser `<Link to>` do React Router.

## 4. Plano de implementação

1. **Novos primitivos em `src/components/shadcn/auth/`:**
   - `auth-card.tsx` — `AuthCard`: card com rim light (span 1px `bg-gradient-to-r
     ... via-foreground/15 ... dark:via-white/20`), `rounded-2xl`, `border-border/70`,
     `bg-card`, `shadow-xs`. Sem padding próprio (o conteúdo mantém
     `CardHeader`/`CardContent`/`CardFooter`). Tokens OKLCH, zero hex.
   - `auth-shell.tsx` — `AuthShell`: shell `grid min-h-svh lg:grid-cols-2` com
     `ModeToggle`, logo via `Link to="/"`, `<Outlet/>` em `max-w-md` e capa
     temática. Usado por `AuthLayout` e `GateLayout` (uma única fonte de layout).
2. **`login-form.tsx`**: props `{ form: UseFormReturn<LoginInput>, onSubmit,
   isPending?, notice?, error?, errorRef? }`. Campos via `form.register`, erros
   via `FieldError` (`role="alert"`), `aria-invalid`/`aria-describedby`, link
   "Esqueceu a senha?" → `<Link to="/recuperar-senha">`, link "Criar conta" →
   `<Link to="/cadastro">`. Botão social removido. Loading com `Loader2`
   (`aria-hidden`).
3. **`signup-form.tsx`**: props `{ onSubmit, children, title?, description?,
   notice?, error?, errorRef?, isPending?, footer? }`. Sem estado local, sem
   toast, sem hash, sem social. Links de termos/privacidade ficam no rodapé da
   página real quando aplicável; no shell do cadastro real não há termos mock.
4. **Páginas reais**: `LoginPage` vira fina (hooks + `LoginForm`); `CadastroPage`
   troca `<Card>` por `<AuthCard>` e embrulha o wizard em `<SignupForm>` via
   props `title/description/error/errorRef/isPending/footer`, preservando TODO o
   conteúdo dos `<fieldset>` e o `Form` provider do RHF. Recuperação/redefinição/
   troca trocam apenas o `<Card>` externo por `<AuthCard>` (rim light).
5. **`AuthLayout`/`GateLayout`**: delegam para `AuthShell`. `GateLayout` passa a
   ter a mesma capa, conforme solicitado ("padronizar ... troca de senha").
6. **`ModeToggle`**: ganha `min-h-11 min-w-11` (alvo ≥44px, WCAG 2.1 AA) sem
   alterar rótulos nem comportamento — teste existente continua válido.
7. **Stories antes das páginas** (storybook-first): `auth.stories.tsx` com
   estados default/loading/error/notice/disabled para `LoginForm` e
   default/loading/error para `SignupForm`, mais `AuthCard`. Templates
   `pages/LoginPage.tsx` atualizados para a nova API de `LoginForm`.

## 5. Deepsearch — fontes consultadas (URL + data da consulta)

- React Hook Form — `handleSubmit`, `formState`, `FormProvider`:
  https://react-hook-form.com/docs/useform/handlesubmit ·
  https://react-hook-form.com/docs/useform ·
  https://react-hook-form.com/docs/formprovider — consultado 2026-11-20.
  Confirma: `handleSubmit(onValid, onInvalid?)` recebe dados validados;
  `aria-invalid` + `<p role="alert">` é o padrão documentado para erro de campo;
  `FormProvider` deve receber o retorno completo do `useForm`.
- React Router v6.28 — `<Link>`:
  https://reactrouter.com/6.28.0/components/link — consultado 2026-11-20.
  Confirma: `LinkProps` omite `href`, exige `to`, aceita `state`, e renderiza
  `<a>` acessível com href real. Base para trocar todos os `href="#/..."` por
  `<Link to>`.
- Design system do destino: `DESIGN.md` §2 (tokens semânticos OKLCH, proibição
  de hex/rgb), §5.4 (ícones lucide, sem `title` direto), §Arquétipo 5 (auth
  split-screen). Arquivo local lido em 2026-11-20.

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Quebrar testes do wizard | DOM interno dos `<fieldset>`/ids `cadastro-*` intacto; só a casca muda. |
| `findByRole("alert")` ambíguo | `SignupForm` só renderiza alert quando `error` não-nulo; no teste de erro-summary não há `serverError`. |
| Asset `/login-cover.svg` ausente | Capa implementada com `BrandIllustration` + tokens, sem `<img>` quebrado e sem cor hardcoded. |
| Alvo de toque do `ModeToggle` (36px) | `min-h-11 min-w-11` adicionado ao botão. |
| Anti-enumeração | `mapAuthError`/`NEUTRAL_MESSAGE` e `state.notice` inalterados. |
