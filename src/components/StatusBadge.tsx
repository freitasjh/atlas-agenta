import { cn } from "@/lib/utils";
import type { AppointmentStatus, SubscriptionStatus } from "@/types/domain";

/**
 * Mapa de cor e rótulo pt-BR por estado do agendamento (analysis-frontend §2.2).
 * Cores aplicadas inline via HSL para manter contraste distinto entre os 6 estados,
 * sem poluir os tokens globais do tema.
 */
const APPOINTMENT_MAP: Record<
  AppointmentStatus,
  { label: string; bg: string; fg: string }
> = {
  pendente: { label: "Pendente", bg: "38 92% 55%", fg: "38 92% 10%" },
  confirmado: {
    label: "Confirmado",
    bg: "var(--primary)",
    fg: "var(--primary-foreground)",
  },
  em_atendimento: {
    label: "Em atendimento",
    bg: "210 90% 60%",
    fg: "210 90% 12%",
  },
  concluido: { label: "Concluído", bg: "160 20% 55%", fg: "160 30% 12%" },
  cancelado: {
    label: "Cancelado",
    bg: "var(--destructive)",
    fg: "0 0% 100%",
  },
  nao_compareceu: {
    label: "Não compareceu",
    bg: "350 40% 45%",
    fg: "350 30% 96%",
  },
};

const SUBSCRIPTION_MAP: Record<
  SubscriptionStatus,
  { label: string; bg: string; fg: string }
> = {
  trial: { label: "Trial", bg: "210 90% 60%", fg: "210 90% 12%" },
  ativo: {
    label: "Ativo",
    bg: "var(--primary)",
    fg: "var(--primary-foreground)",
  },
  pendente: { label: "Pendente", bg: "38 92% 55%", fg: "38 92% 10%" },
  bloqueado: {
    label: "Bloqueado",
    bg: "var(--destructive)",
    fg: "0 0% 100%",
  },
  cancelado: { label: "Cancelado", bg: "215 14% 55%", fg: "215 20% 12%" },
};

function hsl(value: string): string {
  // Aceita tanto um token (var(--x)) quanto uma tripla HSL crua.
  return `hsl(${value})`;
}

interface AppointmentBadgeProps {
  status: AppointmentStatus;
  className?: string;
}

interface SubscriptionBadgeProps {
  subscriptionStatus: SubscriptionStatus;
  className?: string;
}

type StatusBadgeProps = AppointmentBadgeProps | SubscriptionBadgeProps;

function isSubscription(
  props: StatusBadgeProps,
): props is SubscriptionBadgeProps {
  return "subscriptionStatus" in props;
}

/**
 * Badge de status. Por padrão renderiza um AppointmentStatus; passe
 * `subscriptionStatus` para a variante de assinatura.
 */
export function StatusBadge(props: StatusBadgeProps) {
  const entry = isSubscription(props)
    ? SUBSCRIPTION_MAP[props.subscriptionStatus]
    : APPOINTMENT_MAP[props.status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        props.className,
      )}
      style={{
        backgroundColor: hsl(entry.bg),
        color: hsl(entry.fg),
      }}
    >
      {entry.label}
    </span>
  );
}
