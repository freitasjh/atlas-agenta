import * as React from "react";
import { useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  Loader2,
  Pencil,
  Play,
  Wallet,
} from "lucide-react";

import { ClientConfirmedBadge } from "@/components/ClientConfirmedBadge";
import { ComboTag } from "@/components/ComboTag";
import { CommissionAmount } from "@/components/CommissionAmount";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { PaymentStatusBadge } from "@/app/agenda/pagamentos/PaymentStatusBadge";
import { formatMessage } from "@/app/agenda/pagamentos/payments-messages";
import type { PaymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import type { AgendaPaymentFlag } from "@/hooks/useAgendaPaymentFlags";
import { cn } from "@/lib/utils";
import { formatTimeInTenantTz, toTenantLocal } from "@/lib/datetime";
import { serviceColorDotClass } from "@/lib/service-color";
import {
  getAllowedTransitions,
  getTransitionLabel,
} from "@/lib/scheduling-status";
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
  aguardando_deposito: "border-status-pendente",
  confirmado: "border-status-confirmado",
  em_atendimento: "border-status-em-atendimento",
  concluido: "border-status-concluido",
  cancelado: "border-status-cancelado",
  nao_compareceu: "border-status-nao-compareceu",
};

/**
 * Quick actions 1-clique do Dia (ADR-03): a ação primária do status
 * (Confirmar/Iniciar/Concluir) sai do dropdown e vira botão direto; o resto
 * de "Mudar status" vai para o overflow do painel.
 */
export interface DayQuickActions {
  canManage: boolean;
  /** `null` = gating ainda não resolvido (nunca cai no fluxo legado). */
  paymentsFeature: boolean | null;
  isChangingStatus?: boolean;
  onChangeStatus: (
    appointment: AppointmentWithRelations,
    to: AppointmentStatus,
  ) => void;
  onEdit: (appointment: AppointmentWithRelations) => void;
  onDuplicate: (appointment: AppointmentWithRelations) => void;
}

/**
 * DnD intra-dia + alternativa por teclado (ADR-03). O bloco é a origem do
 * arrasto (HTML5) e o alvo do teclado (setas movem o preview em passos de
 * 30min, Enter confirma, Esc cancela); o destino (coluna) mora no Dia.
 */
export interface DayBlockDnd {
  draggable: boolean;
  onDragStart: (
    appointment: AppointmentWithRelations,
    event: React.DragEvent,
  ) => void;
  onDragEnd: () => void;
  /** Confirma o preview do teclado (minutos do dia, já com snap de 30). */
  onCommitMove: (
    appointment: AppointmentWithRelations,
    newStartMinutes: number,
  ) => void;
  /** Anuncia no `aria-live` do Dia (agnóstico a quem renderiza). */
  onAnnounce: (message: string) => void;
}

/** Ação primária 1-clique por status (o resto vai ao overflow). */
const PRIMARY_ACTIONS = {
  pendente: { to: "confirmado", label: "Confirmar", Icon: Check },
  confirmado: { to: "em_atendimento", label: "Iniciar", Icon: Play },
  em_atendimento: { to: "concluido", label: "Concluir", Icon: CircleCheck },
} as const;

type PrimaryStatus = keyof typeof PRIMARY_ACTIONS;

interface AppointmentBlockProps {
  appointment: AppointmentWithRelations;
  timeZone: string;
  /** `true` quando o bloco é muito baixo para caber serviço/profissional. */
  compact?: boolean;
  /** Pode exibir a linha de comissão (gating de segmento + RBAC resolvido no pai). */
  showCommission?: boolean;
  /** Abre o mesmo menu de ações da lista (editar/status/mensagem). */
  onOpen?: (appointment: AppointmentWithRelations) => void;
  /** Estado de pagamento derivado do servidor (ADR-04 §7). */
  paymentFlag?: AgendaPaymentFlag;
  /** Abre o settlement do atendimento (ação "Pagamento"). */
  onOpenPayment?: (appointment: AppointmentWithRelations) => void;
  /** Capacidade do cliente de registrar pagamentos (defesa em profundidade). */
  canRegisterPayments?: boolean;
  /** Catálogo de mensagens (selo/ação). Sem ele, o selo não é renderizado. */
  messages?: PaymentsMessages;
  /** Quick actions do Dia (ADR-03). Ausente = bloco só visual (Semana). */
  quickActions?: DayQuickActions;
  /** Origem de arrasto + teclado (ADR-03). Ausente = bloco estático. */
  dnd?: DayBlockDnd;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Bloco visual de um agendamento no calendário (dia/semana). Um `<button>`
 * principal abre o menu; a ação "Pagamento" (quando aplicável) é um botão
 * irmão — nunca aninhado — e não dispara `onOpen`.
 */
export function AppointmentBlock({
  appointment,
  timeZone,
  compact = false,
  showCommission = false,
  onOpen,
  paymentFlag,
  onOpenPayment,
  canRegisterPayments = false,
  messages,
  quickActions,
  dnd,
  className,
  style,
}: AppointmentBlockProps) {
  const customerName = appointment.customers?.name ?? "Cliente removido";
  const isCombo = appointment.combo_id != null;
  const comboName = appointment.combos?.name ?? "Pacote removido";
  const serviceName = appointment.services?.name ?? "Serviço removido";
  const itemName = isCombo ? comboName : serviceName;
  const professionalName =
    appointment.professionals?.name ?? "Profissional removido";
  const startLabel = formatTimeInTenantTz(appointment.starts_at, timeZone);
  const endLabel = formatTimeInTenantTz(appointment.ends_at, timeZone);
  const durationMinutes = Math.round(
    (new Date(appointment.ends_at).getTime() -
      new Date(appointment.starts_at).getTime()) /
      60000,
  );
  const confirmedByClient =
    appointment.status === "confirmado" &&
    appointment.confirmed_via === "cliente_whatsapp";

  const itemLabel = isCombo ? `Pacote: ${comboName}` : serviceName;
  const title =
    `${startLabel}–${endLabel} · ${customerName} · ${itemLabel} · ${professionalName}` +
    (confirmedByClient ? " · Confirmado pelo cliente no WhatsApp" : "");

  const showPaymentBadge =
    !!messages &&
    !!paymentFlag &&
    paymentFlag !== "unknown" &&
    paymentFlag !== "quitado" &&
    appointment.status === "concluido";
  const showPaymentAction =
    !!messages &&
    !!onOpenPayment &&
    canRegisterPayments &&
    (appointment.status === "em_atendimento" ||
      appointment.status === "concluido");

  // --- Quick actions (ADR-03) -------------------------------------------
  const canAct = !!quickActions?.canManage;
  const primary =
    appointment.status in PRIMARY_ACTIONS
      ? PRIMARY_ACTIONS[appointment.status as PrimaryStatus]
      : null;
  const overflowTransitions = canAct
    ? getAllowedTransitions(appointment.status).filter(
        (to) => to !== primary?.to,
      )
    : [];
  const changing = !!quickActions?.isChangingStatus;
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  function closePanel(refocus = false) {
    setPanelOpen(false);
    if (refocus) toggleRef.current?.focus();
  }

  // --- Teclado do DnD (ADR-03): preview local em passos de 30min ---------
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const startParts = toTenantLocal(appointment.starts_at, timeZone);
  const baseMinutes = startParts.hour * 60 + startParts.minute;

  function previewMinutes(): number {
    return baseMinutes + keyboardOffset;
  }

  function previewLabel(): string {
    const minutes = previewMinutes();
    return `${Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
  }

  function handleMainKeyDown(event: React.KeyboardEvent) {
    if (!dnd) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 30 : -30;
      const next = keyboardOffset + delta;
      // Limita o preview ao dia (00:00–23:30) — o Dia valida o destino final.
      if (baseMinutes + next < 0 || baseMinutes + next > 23 * 60 + 30) return;
      setKeyboardOffset(next);
      const label = `${Math.floor((baseMinutes + next) / 60)
        .toString()
        .padStart(2, "0")}:${((baseMinutes + next) % 60)
        .toString()
        .padStart(2, "0")}`;
      dnd.onAnnounce(
        `Horário movido para ${label}. Enter confirma, Esc cancela.`,
      );
    } else if (event.key === "Enter" && keyboardOffset !== 0) {
      event.preventDefault();
      const target = previewMinutes();
      setKeyboardOffset(0);
      dnd.onCommitMove(appointment, target);
    } else if (event.key === "Escape" && keyboardOffset !== 0) {
      event.preventDefault();
      setKeyboardOffset(0);
      dnd.onAnnounce("Movimento cancelado. Bloco mantido no horário original.");
    }
  }

  return (
    <div
      className={cn("relative h-full", className)}
      style={style}
      draggable={dnd?.draggable}
      onDragStart={
        dnd
          ? (event) => {
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                try {
                  event.dataTransfer.setData(
                    "application/x-appointment",
                    JSON.stringify({
                      id: appointment.id,
                      professionalId: appointment.professional_id,
                    }),
                  );
                } catch {
                  // Clipboard do arrasto indisponível: o Dia guarda a origem.
                }
              }
              dnd.onDragStart(appointment, event);
            }
          : undefined
      }
      onDragEnd={dnd ? () => dnd.onDragEnd() : undefined}
      data-testid={dnd?.draggable ? `day-block-drag-${appointment.id}` : undefined}
      onBlur={
        canAct
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setPanelOpen(false);
              }
            }
          : undefined
      }
    >
      <button
        type="button"
        title={title}
        aria-label={`${customerName}, ${itemLabel} às ${startLabel} · atendimento ${durationMinutes} min · processamento ${appointment.processing_minutes ?? 0} min`}
        onClick={onOpen ? () => onOpen(appointment) : undefined}
        onKeyDown={handleMainKeyDown}
        className={cn(
          "relative flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-lg border border-border/70 border-l-2 bg-card/95 px-2.5 py-2 text-left shadow-xs backdrop-blur-sm",
          "transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 motion-reduce:transition-none",
          STATUS_BORDER[appointment.status],
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
        />
        <span
          aria-hidden="true"
          data-testid="split-timing"
          className="flex h-1.5 w-full overflow-hidden rounded-sm"
        >
          <span
            className="h-full bg-emerald-500 motion-reduce:transition-none"
            style={{
              width: `${
                (appointment.processing_minutes ?? 0) > 0
                  ? Math.round(
                      (durationMinutes /
                        (durationMinutes + (appointment.processing_minutes ?? 0))) *
                        100,
                    )
                  : 100
              }%`,
            }}
          />
          {(appointment.processing_minutes ?? 0) > 0 ? (
            <span
              className="h-full bg-amber-400 motion-reduce:transition-none"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.15) 4px, rgba(0,0,0,0.15) 8px)",
                width: `${Math.round(
                  ((appointment.processing_minutes ?? 0) /
                    (durationMinutes + (appointment.processing_minutes ?? 0))) *
                    100,
                )}%`,
              }}
            />
          ) : null}
        </span>
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
                serviceColorDotClass(
                  appointment.combo_id ?? appointment.service_id,
                ),
              )}
            />
            <span className="truncate">
              {itemName}
              {" · "}
              {professionalName}
            </span>
            {isCombo ? <ComboTag /> : null}
            {appointment.resources && appointment.resources.length > 0 ? (
              <span
                data-testid="resource-chip"
                className="ml-1 inline-flex items-center rounded bg-secondary px-1 text-[10px] font-medium text-secondary-foreground"
              >
                {appointment.resources[0].name}
              </span>
            ) : null}
          </span>
        ) : null}
        {keyboardOffset !== 0 ? (
          <span
            data-testid="move-preview"
            className="w-fit rounded bg-primary/15 px-1 text-xs font-semibold tabular-nums text-foreground"
          >
            → {previewLabel()} (Enter confirma)
          </span>
        ) : null}
        {showPaymentBadge && messages && paymentFlag ? (
          <PaymentStatusBadge
            status={paymentFlag}
            messages={messages}
            className="mt-0.5 w-fit max-w-full truncate text-[10px]"
          />
        ) : null}
        {!compact && showCommission && appointment.status === "concluido" ? (
          <CommissionAmount
            commissionCents={appointment.commission_cents}
            className="truncate text-xs"
          />
        ) : null}
      </button>

      {showPaymentAction && messages ? (
        <Button
          type="button"
          variant="secondary"
          size={compact ? "icon" : "sm"}
          aria-label={formatMessage(messages.agenda.actionPaymentAria, {
            cliente: customerName,
          })}
          onClick={(event) => {
            event.stopPropagation();
            onOpenPayment?.(appointment);
          }}
          className={
            compact
              ? "absolute bottom-0 right-0 z-10 h-11 w-11 min-h-[44px] min-w-[44px] p-0"
              : "absolute bottom-1 right-1 h-11 min-h-[44px] px-2 text-xs"
          }
        >
          {compact ? (
            <Wallet className="h-4 w-4" aria-hidden="true" />
          ) : (
            messages.agenda.actionPayment
          )}
        </Button>
      ) : null}

      {canAct && quickActions ? (
        <>
          <Button
            ref={toggleRef}
            type="button"
            variant="secondary"
            size={compact ? "icon" : "sm"}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            aria-label={`Ações do agendamento de ${customerName} às ${startLabel}`}
            onClick={(event) => {
              event.stopPropagation();
              setPanelOpen((open) => !open);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && panelOpen) {
                event.stopPropagation();
                closePanel(true);
              }
            }}
            className={
              compact
                ? "absolute bottom-0 left-0 z-10 h-11 w-11 min-h-[44px] min-w-[44px] p-0"
                : "absolute bottom-1 left-1 z-10 h-11 min-h-[44px] min-w-[44px] px-2 text-xs"
            }
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 motion-reduce:transition-none",
                panelOpen && "rotate-180",
              )}
              aria-hidden="true"
            />
            {compact ? null : <span className="sr-only sm:not-sr-only">Ações</span>}
          </Button>
          {panelOpen ? (
            <div
              id={panelId}
              role="group"
              aria-label={`Ações rápidas: ${customerName} às ${startLabel}`}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  closePanel(true);
                }
              }}
              className="absolute left-0 top-full z-30 mt-1 min-w-44 max-w-[70vw] space-y-1 rounded-md border border-border bg-popover p-1 shadow-md"
            >
              {primary ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={changing}
                  onClick={() => {
                    closePanel();
                    quickActions.onChangeStatus(appointment, primary.to);
                  }}
                  className="h-11 min-h-[44px] w-full justify-start"
                >
                  {changing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <primary.Icon className="h-4 w-4" aria-hidden="true" />
                  )}
                  {changing ? "Atualizando…" : primary.label}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  closePanel();
                  quickActions.onEdit(appointment);
                }}
                className="h-11 min-h-[44px] w-full justify-start"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Editar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  closePanel();
                  quickActions.onDuplicate(appointment);
                }}
                className="h-11 min-h-[44px] w-full justify-start"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Duplicar
              </Button>
              {overflowTransitions.length > 0 ? (
                <>
                  <div
                    aria-hidden="true"
                    className="mx-1 border-t border-border"
                  />
                  <p className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Mudar status
                  </p>
                  {overflowTransitions.map((to) => (
                    <Button
                      key={to}
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={changing}
                      onClick={() => {
                        closePanel();
                        quickActions.onChangeStatus(appointment, to);
                      }}
                      className="h-11 min-h-[44px] w-full justify-start font-normal"
                    >
                      {getTransitionLabel(to)}
                    </Button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
