import * as React from "react";

import { ClientConfirmedBadge } from "@/components/ClientConfirmedBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import { formatTimeInTenantTz } from "@/lib/datetime";
import { serviceColorDotClass } from "@/lib/service-color";
import type {
  AppointmentStatus,
  AppointmentWithRelations,
} from "@/types/domain";

/**
 * Borda-lateral de status no calendário (mesmo mapa usado pela lista em
 * `AgendaPage`; reforço redundante do `StatusBadge`, nunca cor sozinha).
 */
export const STATUS_BORDER: Record<AppointmentStatus, string> = {
  pendente: "border-status-pendente",
  confirmado: "border-status-confirmado",
  em_atendimento: "border-status-em-atendimento",
  concluido: "border-status-concluido",
  cancelado: "border-status-cancelado",
  nao_compareceu: "border-status-nao-compareceu",
};

interface AppointmentBlockProps {
  appointment: AppointmentWithRelations;
  timeZone: string;
  /** `true` quando o bloco é muito baixo para caber serviço/profissional. */
  compact?: boolean;
  /** Abre o mesmo menu de ações da lista (editar/status/mensagem). */
  onOpen?: (appointment: AppointmentWithRelations) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Bloco visual de um agendamento no calendário (dia/semana). Extrai a parte
 * visual que a lista desenha em `AgendaItem`, sem alterar o comportamento da
 * lista. É um `<button>` focável que abre o mesmo menu de ações (ADR-08 §3);
 * em bloco curto, mostra só cliente + horário e joga o resto no `title`.
 *
 * Os horários são formatados no fuso do tenant (AC-16) — um agendamento às
 * 09:00 local aparece 09:00, nunca deslocado por UTC.
 */
export function AppointmentBlock({
  appointment,
  timeZone,
  compact = false,
  onOpen,
  className,
  style,
}: AppointmentBlockProps) {
  const customerName = appointment.customers?.name ?? "Cliente removido";
  const serviceName = appointment.services?.name ?? "Serviço removido";
  const professionalName =
    appointment.professionals?.name ?? "Profissional removido";
  const startLabel = formatTimeInTenantTz(appointment.starts_at, timeZone);
  const endLabel = formatTimeInTenantTz(appointment.ends_at, timeZone);
  // Selo de origem é determinístico pela coluna `confirmed_via`.
  const confirmedByClient =
    appointment.status === "confirmado" &&
    appointment.confirmed_via === "cliente_whatsapp";

  const title =
    `${startLabel}–${endLabel} · ${customerName} · ${serviceName} · ${professionalName}` +
    (confirmedByClient ? " · Confirmado pelo cliente no WhatsApp" : "");

  return (
    <button
      type="button"
      title={title}
      aria-label={`${customerName}, ${serviceName} às ${startLabel}`}
      onClick={onOpen ? () => onOpen(appointment) : undefined}
      className={cn(
        "flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-md border border-border border-l-2 bg-card p-2 text-left",
        "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        STATUS_BORDER[appointment.status],
        className,
      )}
      style={style}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="truncate text-xs font-semibold tabular-nums text-foreground">
          {startLabel}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {!compact ? (
            <ClientConfirmedBadge appointment={appointment} />
          ) : null}
          <StatusBadge status={appointment.status} className="shrink-0" />
        </span>
      </span>
      <span className="truncate text-sm font-medium text-foreground">
        {customerName}
      </span>
      {!compact ? (
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              serviceColorDotClass(appointment.service_id),
            )}
          />
          <span className="truncate">
            {serviceName}
            {" · "}
            {professionalName}
          </span>
        </span>
      ) : null}
    </button>
  );
}
