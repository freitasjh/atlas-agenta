import { Navigate } from "react-router-dom";

/**
 * Índice da área interna: redirect para Empresas (igual ao `/admin` legado,
 * cujo índice redirecionava para `/admin/empresas`). Hub, não placeholder:
 * nenhuma ação operacional vive aqui.
 */
export function InternalHomePage() {
  return <Navigate to="/internal-admin/empresas" replace />;
}
