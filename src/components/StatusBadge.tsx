import { cn } from "@/lib/utils";
import type { AppointmentStatus, SubscriptionStatus } from "@/types/domain";

/**
 * Mapa de rótulo pt-BR + classes de tema por estado do agendamento
 * (analysis-frontend §2.2). As cores vêm de tokens de status dedicados
 * (`--status-*`), consumidos por classes Tailwind `bg-status-*` /
 * `text-status-*-foreground` — theme-aware (trocam com a classe `.dark`),
 * nunca `style` inline nem os tokens globais `--primary`/`--destructive`.
 */
const APPOINTMENT_MAP: Record<
  AppointmentStatus,
  { label: string; className: string }
> = {
  pendente: {
    label: "Pendente",
    className: "bg-status-pendente text-status-pendente-foreground",
  },
  confirmado: {
    label: "Confirmado",
    className: "bg-status-confirmado text-status-confirmado-foreground",
  },
  em_atendimento: {
    label: "Em atendimento",
    className:
      "bg-status-em-atendimento text-status-em-atendimento-foreground",
  },
  concluido: {
    label: "Concluído",
    className: "bg-status-concluido text-status-concluido-foreground",
  },
  cancelado: {
    label: "Cancelado",
    className: "bg-status-cancelado text-status-cancelado-foreground",
  },
  nao_compareceu: {
    label: "Não compareceu",
    className:
      "bg-status-nao-compareceu text-status-nao-compareceu-foreground",
  },
};

/**
 * Assinatura reusa os tokens do significado coincidente, sem token novo:
 * trial→em-atendimento, ativo→confirmado, pendente→pendente,
 * bloqueado→cancelado, cancelado→sub-cancelado.
 */
const SUBSCRIPTION_MAP: Record<
  SubscriptionStatus,
  { label: string; className: string }
> = {
  trial: {
    label: "Trial",
    className:
      "bg-status-em-atendimento text-status-em-atendimento-foreground",
  },
  ativo: {
    label: "Ativo",
    className: "bg-status-confirmado text-status-confirmado-foreground",
  },
  pendente: {
    label: "Pendente",
    className: "bg-status-pendente text-status-pendente-foreground",
  },
  bloqueado: {
    label: "Bloqueado",
    className: "bg-status-cancelado text-status-cancelado-foreground",
  },
  cancelado: {
    label: "Cancelado",
    className:
      "bg-status-sub-cancelado text-status-sub-cancelado-foreground",
  },
};

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
        entry.className,
        props.className,
      )}
    >
      {entry.label}
    </span>
  );
}
