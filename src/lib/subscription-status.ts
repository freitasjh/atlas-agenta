import { getSubscriptionStatusLabel } from "@/components/StatusBadge";
import { getPlan, type PlanSlug } from "@/lib/plans";
import type { SubscriptionStatus } from "@/types/domain";

/**
 * Máquina de transições de `subscription_status` na UI — **fonte única** do que
 * o select "Mudar status" oferece (ADR-07) e do que a UI usa para esconder
 * destinos inválidos.
 *
 * Espelha 1:1 a máquina canônica do servidor (Edge Function `admin-subscription`,
 * ADR-03 / PRD §3.5). A UI é **defesa de usabilidade** (só oferece transições
 * válidas, menos chamadas 409); a **validação canônica é no servidor**, que
 * rejeita transição inválida de qualquer forma. Fonte única evita divergência
 * entre o select do dialog e a trava do servidor.
 *
 *   trial     -> ativo | pendente | cancelado
 *   ativo     -> pendente | bloqueado | cancelado
 *   pendente  -> ativo | bloqueado | cancelado
 *   bloqueado -> ativo | cancelado
 *   cancelado -> ativo            (reativação; demais bloqueadas)
 *
 * Nunca oferece o mesmo status (no-op) nem `trial` como destino (estado inicial,
 * não destino operacional).
 */
export const ALLOWED_SUBSCRIPTION_TRANSITIONS: Record<
  SubscriptionStatus,
  SubscriptionStatus[]
> = {
  trial: ["ativo", "pendente", "cancelado"],
  ativo: ["pendente", "bloqueado", "cancelado"],
  pendente: ["ativo", "bloqueado", "cancelado"],
  bloqueado: ["ativo", "cancelado"],
  cancelado: ["ativo"],
};

/** Destinos válidos a partir do status atual (espelha o servidor). */
export function getAllowedSubscriptionTransitions(
  status: SubscriptionStatus,
): SubscriptionStatus[] {
  return ALLOWED_SUBSCRIPTION_TRANSITIONS[status];
}

/** True se a transição `from → to` é permitida pela máquina (defesa de UI). */
export function isSubscriptionTransitionAllowed(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return ALLOWED_SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

/**
 * Rótulo pt-BR de um status de assinatura — reexporta a fonte única do
 * `StatusBadge` para o select/filtros sem duplicar os textos.
 */
export function getSubscriptionTransitionLabel(
  status: SubscriptionStatus,
): string {
  return getSubscriptionStatusLabel(status);
}

/**
 * Rótulo pt-BR de um plano de tenant — reusa a fonte única de `src/lib/plans.ts`
 * (`getPlan(slug).nome`), sem mapa local duplicado.
 */
export function getPlanLabel(plan: PlanSlug): string {
  return getPlan(plan).nome;
}
