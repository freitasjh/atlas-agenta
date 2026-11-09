import { Navigate, useParams } from "react-router-dom";

import { isValidTenantId } from "@/hooks/useAdminTenants";

/**
 * Mapa de redirect release 1 (VAL-01): deep-links `/admin/*` continuam
 * funcionando apontando para `/internal-admin/*`. Fase 2 (410 + delete do
 * bloco) é follow-up dedicado — aqui só redireciona, sem lógica de negócio.
 */
export const LEGACY_ADMIN_REDIRECT_MAP: Readonly<Record<string, string>> = {
  "/admin": "/internal-admin",
  "/admin/empresas": "/internal-admin/empresas",
  "/admin/tenants/:id/plano": "/internal-admin/tenants/:id/plano",
  "/admin/assinaturas": "/internal-admin/assinaturas",
  "/admin/metricas": "/internal-admin/metricas",
  "/admin/dashboard": "/internal-admin/dashboard",
  "/admin/convites": "/internal-admin/convites",
  "/admin/auditoria": "/internal-admin/auditoria",
};

/** Redirect estático legado → interno (release 1, `replace` sem empilhar). */
export function LegacyAdminRedirect({ to }: { to: string }) {
  return <Navigate to={to} replace />;
}

/**
 * Redirect do detalhe de plano com guarda de `:id` (mesma regra da tela:
 * slug/injeção cai em Empresas sem query, nunca 404 com dado).
 */
export function LegacyTenantPlanoRedirect() {
  const { id } = useParams();
  if (!isValidTenantId(id)) {
    return <Navigate to="/internal-admin/empresas" replace />;
  }
  return <Navigate to={`/internal-admin/tenants/${id}/plano`} replace />;
}
