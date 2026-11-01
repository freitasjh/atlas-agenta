import { Navigate, Outlet, useLocation } from "react-router-dom";

import { RouteFallback } from "@/components/RouteFallback";
import { DefensiveLogout } from "@/app/guards/DefensiveLogout";
import { decidePasswordGate } from "@/auth/passwordGate";
import { POST_LOGIN_CHANGE_PASSWORD } from "@/auth/resolvePostLoginDestination";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Guard de troca de senha obrigatória (ADR-11). Fica entre `RequireAuth` e os
 * guards de papel/assinatura nas duas árvores (`/app` e `/admin`), porque a
 * flag é da conta, não do papel.
 *
 * Toda a regra mora na função pura `decidePasswordGate`; aqui só há tradução:
 * - `loading` → fallback de rota (sem flash de login);
 * - `anonymous` → `/login` com `state.from` string (`pathname + search`);
 * - `identity-error` → logout defensivo (sessão sem claims confiáveis);
 * - `change-password` → `/trocar-senha`, sem preservar `from` (depois da troca
 *   o destino é o do papel, nunca a página antiga);
 * - `allow` → `<Outlet />`.
 *
 * A própria rota `/trocar-senha` não usa este guard (ADR-10): dentro dele a
 * flag ligada viraria laço, e é essa tela que limpa a flag.
 *
 * Pressupõe `RequireAuth` antes dele: erro de leitura do tenant
 * (`hasTenantError`) já foi tratado ali com o mesmo logout defensivo.
 */
export function RequirePasswordChange() {
  const { pathname, search } = useLocation();
  const {
    isLoadingAuth,
    isAuthenticated,
    hasIdentityError,
    mustChangePassword,
  } = useCurrentUser();

  const decision = decidePasswordGate({
    isLoadingAuth,
    isAuthenticated,
    hasIdentityError,
    mustChangePassword,
    pathname,
  });

  switch (decision) {
    case "loading":
      return <RouteFallback />;
    case "anonymous":
      return (
        <Navigate
          to="/login"
          replace
          state={{ from: `${pathname}${search}` }}
        />
      );
    case "identity-error":
      return <DefensiveLogout />;
    case "change-password":
      return <Navigate to={POST_LOGIN_CHANGE_PASSWORD} replace />;
    case "allow":
      return <Outlet />;
    default: {
      // Exaustividade: um estado novo em `PasswordGateDecision` sem tratamento
      // faz o `tsc` estrito acusar aqui (nunca liberar por omissão).
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}
