import { cn } from "@/lib/utils";

/**
 * Badge "Aguardando depósito" (Fase 4, ADR-12 / PRD RF-06).
 *
 * Reusa os tokens de `pendente` (`--status-pendente`) — sem token novo: o
 * significado coincide (estado transitório aguardando ação) e evita deriva do
 * DS. Texto em `text-status-pendente-foreground` (contraste AA nos dois temas).
 */
export function DepositBadge({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Aguardando depósito"
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        "bg-status-pendente text-status-pendente-foreground",
        className,
      )}
    >
      Aguardando depósito
    </span>
  );
}
