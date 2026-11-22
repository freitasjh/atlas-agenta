# Análise — refatoração internal-admin (branch `refactor/internal-admin-auth`)

Data: 2026-11-20. Escopo: fluxo de autenticação interna (`login` → `mfa` → `enroll`) e casca `/internal-admin`, sem mudar rotas/comportamento de segurança.

## 1. Componentes base (já padronizados no repo)

| Arquivo | Contrato real | Uso na refatoração |
|---|---|---|
| `src/components/shadcn/auth/auth-shell.tsx` | `AuthShell({ contentClassName? })`, renderiza `<Outlet />`; casca Atlas de auth (coluna marca + capa desktop), `ModeToggle`, `Link` do React Router. | Substitui `InternalAdminLayout` como layout-element das rotas `login/mfa/enroll`. Rotas já usam `<Outlet />` (`src/router.tsx:304`), então não muda `router.tsx`. |
| `src/components/shadcn/auth/auth-card.tsx` | Casca sem padding, rim light via `bg-gradient`, `rounded-2xl`, tokens semânticos. | Envolve `LoginForm` e o conteúdo do enroll. |
| `src/components/shadcn/auth/login-form.tsx` | Controlado: `form: UseFormReturn<LoginInput>`, `onSubmit(values)`, `isPending`, `disabled`, `notice`, `error`, `errorRef`. RHF/zod, mutation, anti-enumeração e redirect ficam na página. | Reutilizado no login interno. Extensões **opcionais e retrocompatíveis** necessárias: `title`, `description`, `showForgotPassword`, `showSignupLink`, `submitLabel`, `submitPendingLabel`, `submitClassName`. Defaults preservam os testes de `src/auth/LoginPage` e `auth.test.tsx` (links `/recuperar-senha` e `/cadastro`, botão "Entrar"). |
| `src/components/shadcn/mfa/mfa-challenge-card.tsx` | `MfaChallengeCard({ userContext, onVerify({code,method,trustDevice}), onResendCode?, onCancel?, onSuccess? })`. `MfaUserContext = { userId, userEmail, phoneNumberMasked?, preferredMethod, availableMethods }`. Suporta TOTP/SMS/backup, cooldown de resend, seletor de métodos, trust-device e `InputOtp` length 6. | Reutilizado no MFA interno. Backend (ADR internal-operators) suporta **somente TOTP**, sem SMS/backup/trust-device. Passar `availableMethods: ["totp"]` esconde SMS/backup e o seletor; `showTrustDevice={false}` desliga o checkbox (prop nova, default `true`). |
| `src/components/shadcn/mfa/mfa-types.ts` | `MfaVerificationResult = { success, trustDevice?, message?, remainingAttempts? }`. | `onVerify` da página devolve `message` com tentativas restantes / lockout, preservando os textos testados. |

## 2. Lógica real que não pode mudar

- **Login** (`InternalLoginPage.tsx`): `signInWithPassword`; anti-enumeração por **tempo** (`≥400ms`, medido com `Date.now()`); erro único `GENERIC_LOGIN_ERROR`; `writeMfaPending(sessionStorage)`; `navigate("/internal-admin/mfa", { replace: true })`. Erro com `role="alert"`, `aria-live="assertive"` e foco via `errorRef`.
- **MFA** (`InternalMfaPage.tsx`): janela `mfa_pending` ≤10 min (`readMfaPending`/`isMfaPendingValid`; expirado → limpa + redirect login); `listFactors` (prefere `status === "verified"`) → `challenge({factorId})` → `verify({factorId, challengeId, code})`; 5 tentativas + lockout de 5 min; mensagens "Restam N tentativas" / "Aguarde 5 minutos"; CTA "Ativar autenticador" quando não há factor; foco/select no input em erro; sucesso limpa carimbo e navega para `/internal-admin`.
- **Enroll** (`InternalEnrollPage.tsx`): 3 etapas reais (`enroll({factorType:"totp"})` → `challenge`/`verify` → confirmação de guardar chave), QR 1x, chave copiável, gate por checkbox. Não será trocado por `MfaSetupCard` (componente de template com dados mock); apenas casca/visual alinhado.
- **Casca**: `InternalAdminLayout` (somente logo + `<Outlet />`, `max-w-md`) e `InternalShell` (grade `16rem/1fr`, sidebar 6 links + Sair, skip-link, foco no `h1`). `InternalShell` é decisão **vinculante de ux** ("paridade com DashboardShell, sem redesign") e seus testes travam essa estrutura; não será substituído por `AtlasAdminTemplate` (que injetaria outra sidebar/navegação de tenant e mudaria comportamento). Auditoria em `src/internal-admin`: zero `bg-white/slate/gray/zinc`, zero hex, zero `max-w-7xl`/`container mx-auto`, zero `href="#/..."`. Casca já usa tokens OKLCH do tema.

## 3. Decisão de adaptação

1. `InternalAdminLayout` passa a delegar para `AuthShell` (a casca Atlas oficial do arquétipo 5 de `DESIGN.md`), mantendo o mesmo `Outlet` e a largura `max-w-md`. Nenhuma rota muda.
2. `InternalLoginPage`: apresentação em `AuthCard` + `LoginForm`; lógica Sec/anti-enumeração intacta. Schema local (`password.min(1)`) preservado — o `loginSchema` compartilhado exige 8 caracteres e quebraria o teste de erro genérico.
3. `InternalMfaPage`: apresentação em `MfaChallengeCard` numa variante **single-input** (prop nova `inputMode="single"` + `codeLabel`, `title`, `description`, `submitLabel`, `submitPendingLabel`, `submitClassName`, `showTrustDevice`, `disabled`, `footer`). Isso preserva o DOM contratado pelos testes (`label "Código de 6 dígitos"`, `autocomplete=one-time-code`, `tabular-nums`, botão "Verificar código", status de lockout) enquanto usa o card do template. `MfaUserContext` é construído com `userId` = factor id resolvido em cada `onVerify` (fallback estável antes da primeira chamada), `userEmail: ""` (sem dado de tenant) e `availableMethods: ["totp"]` — sem SMS/backup/trust-device, que o backend não implementa.
4. O card mantém seus defaults para os stories/public feed; as novas props são opcionais. Erro ganha `aria-live="assertive"`; foco no input em erro continua no card.
5. `InternalEnrollPage`: troca `Card` por `AuthCard` + tipografia/ritmo Atlas, lógica e textos intactos.
6. Nenhuma dependência nova; ícones continuam `lucide-react`; links continuam React Router.

## 4. Riscos / pendências

- `AuthShell` (base pré-existente) usa `bg-slate-950/white` na coluna de capa — são cores do template, **fora do escopo** desta refatoração e não alteradas; nenhuma cor fixa foi introduzida no internal-admin.
- `.storybook/` não existe no repo e `package.json` não tem script `storybook:*`; stories são escritas/compiladas pelo `tsc`, mas `storybook:build` não é executável aqui (registrado como limitação, não como gate).
- Não há `AtlasAdminTemplate` na casca de auth por decisão de ux: ele é o shell do backoffice e adicionaria navegação proibida na área isolada.

## 5. Fontes consultadas (deepsearch)

- Contrato MFA Supabase (`listFactors`, `challenge`, `verify`) — https://supabase.com/docs/reference/javascript/auth-mfa-listfactors , https://supabase.com/docs/reference/javascript/auth-mfa-challenge , https://supabase.com/docs/reference/javascript/auth-mfa-verify — consultado 2026-11-20.
- Contrato RHF `handleSubmit` — https://react-hook-form.com/docs/useform/handlesubmit — consultado 2026-11-20 (via nota `auth-padronizacao-componentes-base`).
- Contrato React Router `Link`/`useNavigate` 6.28 — https://reactrouter.com/6.28.0/components/link — consultado 2026-11-20 (via nota acima).
- Contrato visual — `DESIGN.md` (tokens OKLCH, arquétipo 5) e skill `atlas-shadcn-specialist`, carregados nesta sessão.
