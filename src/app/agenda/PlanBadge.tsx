import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";

/**
 * Badge de gating T1.2 (ADR-01): sem entitlements, degrada para nada (retorna
 * `null`) — a agenda nunca trava por causa do badge. Sem nenhum recurso
 * liberado, vira upsell para `/precos` (nunca hide silencioso); com ao menos
 * um recurso, atalho para `/app/config/plano`.
 */
export function PlanBadge() {
  const entitlements = usePlanEntitlements();
  if (!entitlements) return null;

  const algumLiberado =
    entitlements.prontuario ||
    entitlements.pacotes ||
    entitlements.aestheticCheckout;

  if (!algumLiberado) {
    return (
      <Link
        to="/precos"
        aria-label="Ver planos: nenhum recurso do plano atual está liberado"
        className="inline-flex w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Badge
          variant="outline"
          className="gap-1 px-2 py-1 text-xs font-medium tabular-nums"
        >
          <span aria-hidden="true">Plano atual sem recursos liberados</span>
          <span aria-hidden="true" className="font-semibold text-primary">
            Ver planos
          </span>
        </Badge>
      </Link>
    );
  }

  return (
    <Link
      to="/app/config/plano"
      aria-label="Ver detalhes do plano: ao menos um recurso liberado"
      className="inline-flex w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Badge
        variant="outline"
        className="gap-1 px-2 py-1 text-xs font-medium tabular-nums"
      >
        <span aria-hidden="true">Recursos do plano liberados</span>
        <span aria-hidden="true" className="font-semibold text-primary">
          Ver detalhes
        </span>
      </Badge>
    </Link>
  );
}
