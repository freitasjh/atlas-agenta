import * as React from "react";

import { ClientConfirmedBadge } from "@/components/ClientConfirmedBadge";
import { ComboTag } from "@/components/ComboTag";
import { CommissionAmount } from "@/components/CommissionAmount";
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
  /** Pode exibir a linha de comissão (gating de segmento + RBAC resolvido no pai). */
  showCommission?: boolean;
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
  showCommission = false,
  onOpen,
  className,
  style,
}: AppointmentBlockProps) {
  const customerName = appointment.customers?.name ?? "Cliente removido";
  // Agendamento de pacote (`combo_id` preenchido, XOR com `service_id`, ADR-03):
  // o nome do pacote toma o lugar do serviço avulso e ganha o selo "Pacote".
  // Um `combo_id` só existe quando criado como pacote (segmento salão), então a
  // exibição reage ao dado da linha, não ao segmento (não quebra se a flag mudar).
  const isCombo = appointment.combo_id != null;
  const comboName = appointment.combos?.name ?? "Pacote removido";
  const serviceName = appointment.services?.name ?? "Serviço removido";
  // Nome principal: pacote tem prioridade; fallback defensivo quando ambos
  // ausentes num shape inesperado.
  const itemName = isCombo ? comboName : serviceName;
  const professionalName =
    appointment.professionals?.name ?? "Profissional removido";
  const startLabel = formatTimeInTenantTz(appointment.starts_at, timeZone);
  const endLabel = formatTimeInTenantTz(appointment.ends_at, timeZone);
  // Selo de origem é determinístico pela coluna `confirmed_via`.
  const confirmedByClient =
    appointment.status === "confirmado" &&
    appointment.confirmed_via === "cliente_whatsapp";

  // Texto do item para title/aria-label: "Pacote: <nome>" quando há combo.
  const itemLabel = isCombo ? `Pacote: ${comboName}` : serviceName;
  const title =
    `${startLabel}–${endLabel} · ${customerName} · ${itemLabel} · ${professionalName}` +
    (confirmedByClient ? " · Confirmado pelo cliente no WhatsApp" : "");

  return (
    <button
      type="button"
      title={title}
      aria-label={`${customerName}, ${itemLabel} às ${startLabel}`}
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
        <span className="min-w-0 truncate text-xs font-semibold tabular-nums text-foreground">
          {startLabel}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {!compact ? (
            <ClientConfirmedBadge appointment={appointment} />
          ) : null}
          <StatusBadge status={appointment.status} className="shrink-0" />
        </span>
      </span>
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {customerName}
      </span>
      {!compact ? (
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              // Chave de cor: `combo_id` quando é pacote, senão `service_id`
              // (mesma função, outra chave — sem caso especial).
              serviceColorDotClass(appointment.combo_id ?? appointment.service_id),
            )}
          />
          <span className="truncate">
            {itemName}
            {" · "}
            {professionalName}
          </span>
          {isCombo ? <ComboTag /> : null}
        </span>
      ) : null}
      {/* Comissão só no bloco com espaço (não-compacto) e atendimento concluído,
          gated por segmento+RBAC (pai) e recortada pelo RLS (ADR-02).
          CommissionAmount não renderiza nada quando commission_cents é null. */}
      {!compact && showCommission && appointment.status === "concluido" ? (
        <CommissionAmount
          commissionCents={appointment.commission_cents}
          className="truncate text-xs"
        />
      ) : null}
    </button>
  );
}
