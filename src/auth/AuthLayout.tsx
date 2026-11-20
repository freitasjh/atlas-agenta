import { useLocation } from "react-router-dom";

import { AuthShell } from "@/components/shadcn/auth/auth-shell";

/**
 * Layout das rotas públicas de autenticação (login, cadastro, recuperação e
 * redefinição). Visual e capa vêm de `AuthShell`, mesma casca usada por
 * `GateLayout` na troca de senha. O wizard de `/cadastro` usa largura maior.
 */
export function AuthLayout() {
  const { pathname } = useLocation();
  const contentClassName = pathname === "/cadastro" ? "max-w-2xl" : "max-w-md";

  return <AuthShell contentClassName={contentClassName} />;
}
