import { AuthShell } from "@/components/shadcn/auth/auth-shell";

/**
 * Casca bloqueada das etapas de autenticação interna (login, MFA, enroll).
 * Usa `AuthShell internal`: mesmo `<Outlet />` e mesma largura `max-w-md`, mas
 * sem link público, sem seletor de tema e sem a coluna de marketing — nenhuma
 * saída para o fluxo público (SPEC internal-operators-mfa §3, UX vinculante).
 * A rota isolada continua fora de `RequireInternalOperator` (ver `router.tsx`).
 */
export function InternalAdminLayout() {
  return <AuthShell internal />;
}
