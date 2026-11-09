import { Navigate, Outlet } from "react-router-dom";

import { RouteFallback } from "@/components/RouteFallback";
import { AccessDenied } from "@/components/AccessDenied";
import { useInternalOperator } from "@/internal-admin/useInternalOperator";

/**
 * Guard da rota isolada `/internal-admin` (FE-01). Não usa `RequireRole` nem
 * tenant: a única prova é a Edge `verify-operator` (operador ativo + AAL2 por
 * request). Sem MFA cai em `mfa`/`enroll` sem renderizar dado; tenant ou
 * não-operador recebe 403 nomeado (sem redirect silencioso).
 */
export function RequireInternalOperator() {
  const state = useInternalOperator();

  if (state.status === "loading") return <RouteFallback />;
  if (state.status === "unauthenticated") {
    return <Navigate to="/internal-admin/login" replace />;
  }
  if (state.status === "mfa_required") {
    return <Navigate to="/internal-admin/mfa" replace />;
  }
  if (state.status === "forbidden") {
    return (
      <AccessDenied
        backTo="/"
        backLabel="Voltar ao início"
      />
    );
  }
  return <Outlet />;
}
