# Implementação — refatoração internal-admin (branch `refactor/internal-admin-auth`)

Data: 2026-11-20. Base: `ANALYSIS.md` deste diretório. Nenhuma rota, dependência ou regra de segurança alterada.

**Revisão P4 (2026-11-20):** aplicados 2 🔴 + 2 melhorias obrigatórias do code review — casca bloqueada do internal-admin, submit por Enter no MFA single-input, refoco em erro repetido e live region persistente. Detalhes nas seções 1–4 abaixo.

## 1. Tasks concluídas

| # | Task | Resultado |
|---|---|---|
| 1 | Registrar análise | `ANALYSIS.md` — componentes base, lógica real, decisão de adaptação, fontes. |
| 2 | Login interno com `AuthShell` + `LoginForm` | `InternalAdminLayout` delega ao `AuthShell`; `InternalLoginPage` usa `AuthCard` + `LoginForm`. RHF/zod local, anti-enumeração por timing (≥400ms), `GENERIC_LOGIN_ERROR`, `writeMfaPending`, redirect preservados. |
| 3 | MFA com `MfaChallengeCard` | Página usa o card na variante single-input; `onVerify` chama `listFactors → challenge → verify` reais; `userId` do factor, `availableMethods: ["totp"]`, sem SMS/backup/trust-device; lockout 5 tentativas/5min, TTL ≤10min, CTA enroll e redirects preservados. |
| 4 | Enroll coerente | `InternalEnrollPage` em `AuthCard`, `<h1>` Atlas, mesma lógica de 3 etapas; CTA "Ativar autenticador" do MFA navega para `/internal-admin/enroll` via `useNavigate`. |
| 5 | Casca e telas internas | `InternalShell` recebe `border-border/70` e foco visível no skip-link; auditoria encontrou **zero** cores fixas/hex/`max-w-7xl`/`href="#/"` em `src/internal-admin`. Demais telas mantidas (ux vinculante + testes travam estrutura). |
| 6 | Navegação | Todo link interno usa React Router (`Link`/`useNavigate`); nenhum `href="#/..."` introduzido. |
| 7 | Validação | typecheck, build e H3 browser light/dark/mobile (fase 1); contagem final na §3. |
| 8 | Registro | Este arquivo. |
| 9 | 🔴 Casca bloqueada | `AuthShell` ganha `internal?: boolean`: nessa variante não há `<Link to="/">`, `ModeToggle` nem coluna de marketing; `Outlet` e `max-w-md` preservados. `InternalAdminLayout` usa `<AuthShell internal />`. |
| 10 | 🔴 Enter no MFA | Visão `isSingleInput` embrulhada em `<form noValidate onSubmit>` com `preventDefault()`; CTA vira `type="submit"`; "Voltar"/"Tentar de outra forma" seguem `type="button"`. Variantes `otp`/`backup` inalteradas. |
| 11 | Refoco em erro repetido | Helper `fail(message)` seta erro, limpa o código e agenda `requestAnimationFrame` para `focus()+select()` no `singleInputRef`. Usado nos 2 branches de erro de `handleVerify` e no `catch`; `handleResend` reutiliza o foco sem limpar o código. Efeito antigo dependente de `errorMessage` removido (mesma mensagem não disparava re-render do efeito). |
| 12 | Live region persistente | `role="alert"` sempre montado, vazio quando sem erro, com `aria-live="assertive" aria-atomic="true"` em `mfa-challenge-card.tsx` e `login-form.tsx`; só o texto muda. |
| 13 | Registro da revisão | Testes TDD, story `AuthShell.Internal`, H3 revalidado e este arquivo atualizado. |

> Bug estrutural encontrado durante TDD: `ChallengeFrame` declarado dentro do componente mudava de tipo a cada render e remontava o input (perda de foco a cada dígito). Movido para escopo de módulo; coberto pelos testes de Enter/refoco.

## 2. Diff resumo

| Arquivo | Mudança |
|---|---|
| `src/components/shadcn/auth/login-form.tsx` | Props opcionais retrocompatíveis: `title`, `description`, `showForgotPassword`, `showSignupLink`, `submitLabel`, `submitPendingLabel`, `submitClassName`; `<h1>` segue escala Atlas (`text-xl sm:text-2xl`). **Revisão:** erro em live region persistente (`role="alert" aria-live="assertive" aria-atomic="true"`), sempre montada e vazia quando sem erro. Defaults preservam `src/auth/LoginPage` e stories. |
| `src/components/shadcn/auth/auth-shell.tsx` | **Novo na revisão:** prop `internal?: boolean` (default `false`). `internal` remove link público, `ModeToggle` e `aside` de marketing; mantém `Outlet`, `max-w-md` e o recorte de coluna única. Default intacto para `AuthLayout`/`GateLayout`. |
| `src/components/shadcn/mfa/mfa-challenge-card.tsx` | Props opcionais: `inputMode` (`otp`\|`single`), `codeLabel`, `codeMaxLength`, `title`, `titleAs`, `description`, `submitLabel`, `submitPendingLabel`, `submitClassName`, `showTrustDevice`, `disabled`, `footer`. Single-input usa `ForwardedInput` (ref real) com `autocomplete="one-time-code"`/`tabular-nums`; `disabled` bloqueia input/botão; slot `footer` para CTA/status. **Revisão:** `ChallengeFrame` (escopo de módulo) com `<form noValidate onSubmit>` no modo single, CTA `type="submit"`, `fail()` com rAF para refoco/select, live region persistente com `aria-atomic`. Defaults inalterados. |
| `src/internal-admin/pages/InternalLoginPage.tsx` | Apresentação em `AuthCard` + `LoginForm`; lógica de segurança intacta. |
| `src/internal-admin/pages/InternalMfaPage.tsx` | Apresentação em `MfaChallengeCard`; `handleVerify` adaptado às chamadas reais; lockout/TTL/status/CTA no `footer`; `onCancel`/`onSuccess` via `useNavigate`. |
| `src/internal-admin/pages/InternalEnrollPage.tsx` | `Card` → `AuthCard`; título `<h1>`; lógica e textos intactos. |
| `src/internal-admin/InternalAdminLayout.tsx` | Delega para `<AuthShell internal />` — casca bloqueada (mesmo `Outlet`/`max-w-md`, sem saídas públicas). |
| `src/internal-admin/InternalShell.tsx` | Tokens de borda `/70` + foco visível no skip-link. |
| Testes | Fase 1: `auth.test.tsx` +2, **novo** `mfa-challenge-card.test.tsx` +5. Revisão: `auth.test.tsx` +3 (`AuthShell` internal/default, live region persistente), `mfa-challenge-card.test.tsx` +4 (Enter/form, botões `type=button`, live region, refoco em erro repetido), `InternalLoginPage.test.tsx` ajustado para esperar o texto na region persistente. Total final: **1716 testes**. |
| Stories | `LoginForm.InternalVariant`; `MfaChallengeCard.InternalTotpSingle`, `InternalTotpError`, `InternalTotpLocked`; **novo** `AuthShell.Default` / `AuthShell.Internal`. |
| Docs/evidência | `ANALYSIS.md`, `IMPLEMENTATION.md`, screenshots em `.spec/internal-admin-auth/*.png` (inclui `review-fix-login-shell.png`, `review-fix-mfa-error.png`, `review-fix-login-mobile-375.png`). |

## 3. Validação

- `npm run typecheck` — ✅ 0 erros (revalidado após revisão).
- `npm test` — ✅ **240 arquivos / 1716 testes, 0 falhas** (1709 antes da revisão; +7 novos casos +0 quebra).
- `npm run build` — ✅ `tsc -b && vite build` exit 0 (único aviso pré-existente de chunk >500kB).
- `npx oxlint src` — 0 erros; warnings pré-existentes em arquivos não tocados.
- `scripts/verify.sh` — ausente neste repo (gate Atlas não executável); registrado como limitação, não como falha.

### H3 — browser (chrome-devtools, 2026-11-20)

- **Snapshot login (pré-revisão)** (`/internal-admin/login`): casca `AuthShell` padrão com logo, `ModeToggle`, `<h1>Área interna`, 2 inputs, 1 botão "Entrar"; sem links de cadastro/recuperação; capa desktop presente. **Este estado foi corrigido pelo 🔴 1** — não é mais o esperado.
- **Interação real login**: credenciais inválidas → `role="alert" aria-live="assertive"` focado com `E-mail ou senha inválidos.`; único `[error]` no console é o log de rede do 400 esperado do Supabase (comportamento anti-enumeração, não exceção de app).
- **MFA** (`/internal-admin/mfa`, com `mfa_pending` válido): `<h1>` nível 1, input focado `autocomplete=one-time-code`, botão desabilitado até 6 dígitos, sem trust-device/seletor de método. Ao submeter sem session válida: erro `Nenhum autenticador ativo...` + CTA "Ativar autenticador"; clique navega para `/internal-admin/enroll`. Console limpo (0 `[ERROR]`/`[WARN]` de app).
- **Enroll**: `<h1>` nível 1, step 1/3, botão "Gerar QR de ativação"; console limpo.
- **Tema**: screenshots `login-light.png`, `login-dark.png`, `mfa-light.png`, `mfa-no-authenticator.png`, `enroll-light.png`, `login-mobile-375.png` (viewport 375×800, sem overflow horizontal). Console limpo após alternância de tema.
- **H3 pós-revisão (chrome-devtools, 2026-11-20, Vite `:5174`)**:
  - `/internal-admin/login`: snapshot sem `aside`, sem `a[href="/"]` e sem botão de tema (0/0/0); `.max-w-md` presente; `<h1>Área interna`; única live region `role="alert" aria-live="assertive" aria-atomic="true"` montada vazia; `scrollX=false` em 375×800.
  - `/internal-admin/mfa` (`mfa_pending` válido): input focado, CTA desabilitado até 6 dígitos; digitar `123456` + **Enter** disparou a verificação (erro `Nenhum autenticador ativo...`) sem reload; região `alert` atualizou só o texto; campo limpo e **refocado** (`focused=mfa-single-code`). Segundo Enter com a mesma mensagem também refocou — cobre o 🔴 2 e a melhoria 3.
  - Console: só `[debug]` do Vite e `[info]` do React DevTools — **zero `[ERROR]`/`[WARN]` de app**. Screenshots: `review-fix-login-shell.png`, `review-fix-mfa-error.png`, `review-fix-login-mobile-375.png`.
- **Portas**: nenhum servidor foi iniciado por esta task; Vite pré-existente em `:5174` (PID 1195152) não foi encerrado (não pertence a esta sessão). Nenhum `pkill -f` usado. Aba aberta por esta verificação foi fechada; emulação removida. O `sessionStorage` de `mfa_pending` da aba de teste foi descartado com o fechamento da aba.

## 4. Stories (estados)

| Componente | Estados |
|---|---|
| `LoginForm` | `Default`, `Loading`, `Error`, `Notice`, `Disabled`, `InternalVariant` (novo). |
| `MfaChallengeCard` | `ChallengeTOTP`, `ChallengeSMS`, `ChallengeWithError`, `InternalTotpSingle`, `InternalTotpError`, `InternalTotpLocked`, `ChallengeDarkMode`, `SetupDialogInteractive`, `BackupCodesManagement`. |
| `AuthShell` (novo) | `Default` (link público + toggle + capa), `Internal` (só marca + `Outlet`, casca bloqueada). |

> `.storybook/` e scripts `storybook:*` não existem no repo; stories compilam via `tsc` mas `storybook:build` não foi executável (limitação registrada, não gate).

## 5. Segurança preservada

- Anti-enumeração: tempo mínimo 400ms e erro único `GENERIC_LOGIN_ERROR` — inalterados.
- `mfa_pending` TTL ≤10min: expirado/ausente → limpa storage e redireciona ao login — inalterado.
- Lockout: 5 tentativas → 5min, contador reiniciado ao expirar — inalterado (agora com timer de liberação).
- AAL2/Aprove real: `listFactors` (prefere `verified`) → `challenge({factorId})` → `verify({factorId, challengeId, code})` — inalterado.
- Shell bloqueado (🔴 1): `/internal-admin/{login,mfa,enroll}` usa `AuthShell internal` — sem link público, sem troca de tema e sem capa de marketing; nenhuma saída para o fluxo público (SPEC §3 + parecer UX vinculante).
- Out of scope: a capa do template mantém suas cores na variante **pública** de `AuthShell` (base pré-existente); nenhuma cor fixa foi adicionada ao internal-admin.

## 6. Fontes (deepsearch)

- Supabase Auth MFA — `listFactors`: https://supabase.com/docs/reference/javascript/auth-mfa-listfactors — consultado 2026-11-20.
- Supabase Auth MFA — `challenge`: https://supabase.com/docs/reference/javascript/auth-mfa-challenge — consultado 2026-11-20.
- Supabase Auth MFA — `verify`: https://supabase.com/docs/reference/javascript/auth-mfa-verify — consultado 2026-11-20.
- RHF `handleSubmit`: https://react-hook-form.com/docs/useform/handlesubmit — consultado 2026-11-20.
- React Router 6.28 `Link`/`useNavigate`: https://reactrouter.com/6.28.0/components/link — consultado 2026-11-20.
- MDN `Window.requestAnimationFrame()` (callback antes do próximo repaint; usado no refoco): https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame — consultado 2026-11-20.
- MDN `HTMLFormElement: submit event` (Enter em input de texto dispara submissão implícita quando há submit button habilitado): https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit_event — consultado 2026-11-20.
- Visual: `DESIGN.md` (tokens OKLCH, arquétipos 4/5) + skills `atlas-shadcn-specialist`, `frontend-react-specialist` e `frontend-design` carregadas nesta sessão.
