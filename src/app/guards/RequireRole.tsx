import { Outlet } from "react-router-dom";

import type { Role } from "@/types/domain";

interface RequireRoleProps {
  /** Papéis autorizados a acessar as rotas filhas. */
  roles: Role[];
}

/**
 * Stub de guard de RBAC (passthrough).
 *
 * Contrato futuro (fase de auth): deriva o `role` do usuário a partir de
 * `profiles` e nega/redireciona quem estiver fora de `roles`. O `role` vem
 * sempre do JWT/`profiles` — nunca de parâmetro do cliente; o `tenant_id`
 * jamais é lido ou enviado aqui (isolamento é do RLS).
 *
 * Hoje renderiza direto o `<Outlet/>`.
 */
export function RequireRole(_props: RequireRoleProps) {
  // TODO(auth): derivar role de profiles e negar quem estiver fora de roles.
  return <Outlet />;
}
