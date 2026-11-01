import { POST_LOGIN_CHANGE_PASSWORD } from "@/auth/resolvePostLoginDestination";

/**
 * Decisão do guard de troca obrigatória (ADR-11). Função pura, sem React e sem
 * rede: os guards (`RequirePasswordChange`) só traduzem o resultado.
 *
 * A ordem das regras é o contrato — a primeira que casa vence:
 * 1. `isLoadingAuth` → `loading`: enquanto a identidade resolve não há decisão
 *    confiável, nem de acesso nem de troca;
 * 2. sem sessão → `anonymous`: quem não está autenticado não troca senha;
 * 3. `hasIdentityError` → `identity-error`: sessão sem claims confiáveis é
 *    falha de autorização, não flag ligada — o guard faz logout defensivo;
 * 4. `mustChangePassword` → `change-password`, exceto na própria tela de troca
 *    (`/trocar-senha`): redirecionar para ela mesma criaria laço;
 * 5. caso contrário → `allow`.
 */
export type PasswordGateDecision =
  | "loading"
  | "anonymous"
  | "identity-error"
  | "change-password"
  | "allow";

/** Entrada da decisão — exatamente os sinais que `useCurrentUser` expõe. */
export interface PasswordGateInput {
  /** True enquanto a sessão (ou o tenant, quando há um) não resolveu. */
  isLoadingAuth: boolean;
  /** Sessão viva (`session !== null`). */
  isAuthenticated: boolean;
  /** Claims de identidade ausentes/inválidas. */
  hasIdentityError: boolean;
  /** Claim `must_change_password` (ADR-01). */
  mustChangePassword: boolean;
  /** `location.pathname` atual — a própria tela de troca é a exceção. */
  pathname: string;
}

/**
 * Decide o que o guard de troca obrigatória faz na rota atual. A flag vale para
 * a conta, não para o papel: o mesmo resultado vale em `/app` e `/admin`.
 */
export function decidePasswordGate({
  isLoadingAuth,
  isAuthenticated,
  hasIdentityError,
  mustChangePassword,
  pathname,
}: PasswordGateInput): PasswordGateDecision {
  if (isLoadingAuth) return "loading";
  if (!isAuthenticated) return "anonymous";
  if (hasIdentityError) return "identity-error";
  if (mustChangePassword && pathname !== POST_LOGIN_CHANGE_PASSWORD) {
    return "change-password";
  }

  return "allow";
}
