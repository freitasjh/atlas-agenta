import type { BadgeProps } from "@/components/ui/badge";
import type { MembershipSubscriptionStatus } from "@/lib/membership";

/**
 * Metadados pt-BR de status de assinatura (ADR-05): rótulo + variante de
 * Badge. Fonte única reusada pela tabela e pelo drawer.
 */
export const statusAssinaturaMeta: Record<
  MembershipSubscriptionStatus,
  { rotulo: string; variant: NonNullable<BadgeProps["variant"]> }
> = {
  ativa: { rotulo: "Ativa", variant: "default" },
  inadimplente: { rotulo: "Inadimplente", variant: "destructive" },
  pausada: { rotulo: "Pausada", variant: "secondary" },
  cancelada: { rotulo: "Cancelada", variant: "outline" },
};

export type AbaAssinatura = "ativas" | "inadimplentes" | "canceladas";

/** Aba Ativas agrega `ativa` + `pausada` (pausada segue operável no drawer). */
export function statusNaAba(status: MembershipSubscriptionStatus, aba: AbaAssinatura): boolean {
  if (aba === "ativas") return status === "ativa" || status === "pausada";
  if (aba === "inadimplentes") return status === "inadimplente";
  return status === "cancelada";
}
