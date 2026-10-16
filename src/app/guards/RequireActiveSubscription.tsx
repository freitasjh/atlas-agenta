import { Outlet } from "react-router-dom";

/**
 * Stub de guard de status de assinatura (passthrough).
 *
 * Contrato futuro (fase de billing): lê `tenants.subscription_status`.
 * `bloqueado` → redireciona para a tela de quitação; `cancelado` → acesso
 * suspenso. O status vem do backend via RLS; nenhum `tenant_id` é lido ou
 * enviado pelo cliente.
 *
 * Hoje renderiza direto o `<Outlet/>`.
 */
export function RequireActiveSubscription() {
  // TODO(billing): ler tenants.subscription_status; bloqueado -> tela de quitação.
  return <Outlet />;
}
