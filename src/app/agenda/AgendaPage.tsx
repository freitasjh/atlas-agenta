import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Pencil,
  Plus,
  ShoppingCart,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { CommissionAmount } from "@/components/CommissionAmount";
import { ComboTag } from "@/components/ComboTag";
import { SendMessageDialog } from "@/app/whatsapp/SendMessageDialog";
import { ClientConfirmedBadge } from "@/components/ClientConfirmedBadge";
import { StatusBadge, getAppointmentStatusLabel } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useDepositCharge } from "@/hooks/useDepositCharge";
import type { DepositCharge } from "@/lib/validations/deposit";

import { AppointmentDrawer } from "@/app/agenda/AppointmentDrawer";
import { WaitlistCta } from "@/app/agenda/WaitlistCta";
import { StatusChangeConfirm } from "@/app/agenda/StatusChangeConfirm";
import { WalkInBadge } from "@/app/pdv/WalkInBadge";
import { PaymentCaptureDialog } from "@/app/agenda/pagamentos/PaymentCaptureDialog";
import { AppointmentSettlementDialog } from "@/app/agenda/pagamentos/AppointmentSettlementDialog";
import { PaymentStatusBadge } from "@/app/agenda/pagamentos/PaymentStatusBadge";
import {
  formatMessage,
  paymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";
import { AgendaCalendarDay } from "@/app/agenda/AgendaCalendarDay";
import { AgendaCalendarWeek } from "@/app/agenda/AgendaCalendarWeek";
import { PlanBadge } from "@/app/agenda/PlanBadge";
import {
  useAgendaView,
} from "@/app/agenda/AgendaViewToggle";
import { ResumoDoDia } from "@/app/agenda/ResumoDoDia";
import {
  resolveDuplicatePrefill,
  suggestDuplicateSlot,
} from "@/app/agenda/duplicateAppointment";
import { AgendaQuickFilters } from "@/app/agenda/AgendaQuickFilters";import { AgendaFilterChips } from "@/app/agenda/AgendaFilterChips";
import { AgendaFilterPopover } from "@/app/agenda/AgendaFilterPopover";
import { BulkActionBar } from "@/app/agenda/BulkActionBar";
import { BulkStatusConfirm } from "@/app/agenda/BulkStatusConfirm";
import { useBulkSelection } from "@/app/agenda/useBulkSelection";
import {
  useBulkTransition,
  type BulkTransitionItem,
} from "@/app/agenda/useBulkTransition";
import { computeDaySummary } from "@/app/agenda/model/daySummary";
import { maskDaySummaryForRole } from "@/app/agenda/model/financialMask";
import {
  mapSchedulingError,
  useAppointments,
  useAppointmentsRange,
  useChangeAppointmentStatus,
} from "@/hooks/useAppointments";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useServices } from "@/hooks/useServices";
import { useResources } from "@/hooks/useResources";
import { usePermissions } from "@/hooks/usePermissions";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useAutoSendConfirmation } from "@/hooks/useAutoSendConfirmation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSegmentTerms } from "@/hooks/useSegmentTerms";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import {
  useAgendaPaymentFlags,
  type AgendaPaymentFlag,
} from "@/hooks/useAgendaPaymentFlags";
import { hasValidPackageCredit } from "@/hooks/useValidPackageCredit";
import {
  useWorkingHoursMany,
} from "@/hooks/useWorkingHours";
import {
  formatTimeInTenantTz,
  toTenantLocal,
  weekRangeOf,
} from "@/lib/datetime";
import { formatCentsToBRL } from "@/lib/money";
import { serviceColorDotClass } from "@/lib/service-color";
import { cn } from "@/lib/utils";
import {
  getAllowedTransitions,
  getTransitionLabel,
  isFinalStatus,
  SENSITIVE_TRANSITIONS,
} from "@/lib/scheduling-status";
import {
  type AppointmentStatus,
  type AppointmentWithRelations,
} from "@/types/domain";

/** `YYYY-MM-DD` de hoje no fuso do tenant (default do filtro de dia). */
function todayInTenantTz(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // en-CA já formata como YYYY-MM-DD.
  return parts;
}

/** Soma `days` a um `YYYY-MM-DD` (aritmética de calendário, sem fuso). */
function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Weekday (0=domingo) de um `YYYY-MM-DD`, independente de fuso. */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Valida o formato `YYYY-MM-DD` de um dia vindo da URL (ex.: link do painel). */
function isValidIsoDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Faixa vertical de status na lista (reforço textual do `StatusBadge`). */
const STATUS_STRIPE: Record<AppointmentStatus, string> = {
  pendente: "bg-status-pendente",
  aguardando_deposito: "bg-status-pendente",
  confirmado: "bg-status-confirmado",
  em_atendimento: "bg-status-em-atendimento",
  concluido: "bg-status-concluido",
  cancelado: "bg-status-cancelado",
  nao_compareceu: "bg-status-nao-compareceu",
};

/** Um item da timeline do dia. */
function AgendaItem({
  appointment,
  timeZone,
  canManage,
  canSendMessage,
  showCommission,
  paymentsState,
  paymentFlag,
  canRegisterPayments,
  onOpenPayment,
  onEdit,
  onChangeStatus,
  onSendMessage,
  selection,
}: {
  appointment: AppointmentWithRelations;
  timeZone: string;
  canManage: boolean;
  canSendMessage: boolean;
  /** Pode exibir a linha de comissão (gating de segmento + RBAC resolvido no pai). */
  showCommission: boolean;
  /** `null` = recurso ainda não resolvido (D5); nunca cai no fluxo legado. */
  paymentsState: boolean | null;
  paymentFlag?: AgendaPaymentFlag;
  canRegisterPayments: boolean;
  onOpenPayment: (appointment: AppointmentWithRelations) => void;
  onEdit: (appointment: AppointmentWithRelations) => void;
  onChangeStatus: (
    appointment: AppointmentWithRelations,
    to: AppointmentStatus,
  ) => void;
  onSendMessage: (appointment: AppointmentWithRelations) => void;
  /** Seleção do lote (ADR-04). Ausente = item sem checkbox (sem permissão
      ou status final — finais nem entram no lote). */
  selection?: {
    checked: boolean;
    onToggle: () => void;
  };
}) {
  const loadingHintId = useId();
  const transitions = getAllowedTransitions(appointment.status);
  const showStatusMenu =
    canManage && !isFinalStatus(appointment.status) && transitions.length > 0;
  // Opt-in na borda: sem consentimento, a ação fica desabilitada com o motivo
  // em texto (defesa dupla; a trava real é o servidor).
  const optIn = appointment.customers?.whatsapp_opt_in ?? false;
  // Agendamento de pacote (`combo_id` preenchido, XOR com `service_id`): o nome
  // do pacote toma o lugar do serviço e ganha o selo "Pacote". Reage ao dado da
  // linha, não ao segmento (um `combo_id` só existe no ramo salão).
  const isCombo = appointment.combo_id != null;
  const itemName = isCombo
    ? (appointment.combos?.name ?? "Pacote removido")
    : (appointment.services?.name ?? "Serviço removido");

  return (
    <li
      className="relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 shadow-xs"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          STATUS_STRIPE[appointment.status],
        )}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          {selection ? (
            <Checkbox
              checked={selection.checked}
              onCheckedChange={() => selection.onToggle()}
              aria-label={`Selecionar agendamento de ${appointment.customers?.name ?? "cliente de balcão"} às ${formatTimeInTenantTz(appointment.starts_at, timeZone)}`}
              className="mt-1 h-5 w-5 min-h-[20px] min-w-[20px]"
            />
          ) : null}
          <div className="flex min-w-0 gap-4">
            <div className="flex shrink-0 flex-col items-center rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums text-foreground">
              <span>{formatTimeInTenantTz(appointment.starts_at, timeZone)}</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                {formatTimeInTenantTz(appointment.ends_at, timeZone)}
              </span>
            </div>
          <div className="min-w-0 space-y-1">
            <p className="break-words font-medium text-foreground">
              {appointment.customers?.name ??
                (appointment.customer_id == null
                  ? "Cliente de balcão"
                  : "Cliente removido")}
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-2 w-2 shrink-0 rounded-full",
                  // Chave de cor: `combo_id` quando é pacote, senão `service_id`.
                  serviceColorDotClass(
                    appointment.combo_id ?? appointment.service_id,
                  ),
                )}
              />
              <span className="min-w-0 break-words">
                {itemName}
                {" · "}
                {appointment.professionals?.name ?? "Profissional removido"}
              </span>
              {isCombo ? <ComboTag /> : null}
            </p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatCentsToBRL(appointment.price_cents)}
            </p>
            {/* Comissão só no atendimento concluído, gated por segmento+RBAC
                (pai) e pelo RLS (que recorta o snapshot). CommissionAmount não
                renderiza nada quando commission_cents é null. */}
            {showCommission && appointment.status === "concluido" ? (
              <CommissionAmount commissionCents={appointment.commission_cents} />
            ) : null}
            </div>
          </div>
        </div>

        {/* `min-w-0` + `flex-wrap` no eixo das ações: em 375 px o conjunto
            (selo + 3 botões) quebra linha em vez de esticar o documento.
            Nenhum controle é escondido. */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-col sm:items-end">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge status={appointment.status} />
            {appointment.origin === "walk_in" ? <WalkInBadge /> : null}
            <ClientConfirmedBadge appointment={appointment} />
            {appointment.status === "concluido" &&
            paymentFlag &&
            paymentFlag !== "unknown" &&
            paymentFlag !== "quitado" ? (
              <PaymentStatusBadge
                status={paymentFlag}
                messages={paymentsMessages}
              />
            ) : null}
          </div>
          {canManage ? (
            <div
              data-testid="agenda-item-actions"
              className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end"
            >
              {paymentsState === true &&
              canRegisterPayments &&
              (appointment.status === "em_atendimento" ||
                appointment.status === "concluido") ? (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={formatMessage(
                    paymentsMessages.agenda.actionPaymentAria,
                    {
                      cliente: appointment.customers?.name ?? "",
                    },
                  )}
                  onClick={() => onOpenPayment(appointment)}
                  className="h-11 min-h-[44px] max-w-full"
                >
                  {paymentsMessages.agenda.actionPayment}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(appointment)}
                className="max-w-full"
              >
                <Pencil aria-hidden="true" />
                Editar
              </Button>
              {canSendMessage ? (
                <div className="flex min-w-0 max-w-full flex-col items-start">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!optIn}
                    className="max-w-full"
                    title={
                      optIn
                        ? undefined
                        : "Este cliente não autorizou receber mensagens no WhatsApp."
                    }
                    onClick={() => onSendMessage(appointment)}
                  >
                    <MessageCircle aria-hidden="true" />
                    Enviar mensagem
                  </Button>
                  {!optIn ? (
                    <span className="sr-only">
                      Este cliente não autorizou receber mensagens no WhatsApp.
                    </span>
                  ) : null}
                </div>
              ) : null}
              {showStatusMenu ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Mudar status
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {transitions.map((to) => {
                      const concludeLoading =
                        to === "concluido" && paymentsState === null;
                      return (
                        <DropdownMenuItem
                          key={to}
                          disabled={concludeLoading}
                          aria-describedby={
                            concludeLoading ? loadingHintId : undefined
                          }
                          onSelect={() => onChangeStatus(appointment, to)}
                        >
                          {concludeLoading
                            ? paymentsMessages.agenda.concludeLoading
                            : getTransitionLabel(to)}
                          {concludeLoading ? (
                            <span id={loadingHintId} className="sr-only">
                              {paymentsMessages.gating.loading}
                            </span>
                          ) : null}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Tela de Agenda (`/app/agenda`): lista por profissional/dia (timeline
 * vertical), criação com derivações (término/valor a partir do serviço) e
 * mudança de status pela máquina de estados. É **lista**, não calendário, e
 * **não** gera slots (escopo da fase).
 *
 * RBAC (defesa em profundidade sobre o RLS): `professional` vê só a própria
 * agenda — o filtro de profissional some e o form trava o seletor nele;
 * `admin`/`receptionist` gerem todos. `professional` sem `professionals`
 * vinculado vê um estado vazio honesto.
 */
export function AgendaPage() {
  const {
    canManageAppointments,
    canScheduleForAnyProfessional,
    canSendWhatsAppMessage,
    canViewCommission,
    canViewFinancials,
    canRegisterPayments,
  } = usePermissions();
  const {
    commission: commissionFeature,
    payments: paymentsFeature,
  } = useSegmentFeatures();
  // ADR-07 (G5): clínica tem `payments:false` no segmento e ganha o checkout
  // via entitlement `aestheticCheckout` (ADR-01). Salão/barbearia inalterados
  // (`payments:true` decide sozinho); `segment-features` intocado. `null`
  // (tenant não resolvido) nunca cai no fluxo legado — D5 mantido.
  const entitlements = usePlanEntitlements();
  const aestheticCheckout = entitlements?.aestheticCheckout === true;
  const waitlistEntitled = entitlements?.waitlist === true;
  const checkoutEnabled =
    paymentsFeature === true ||
    (paymentsFeature === false && aestheticCheckout);
  // Tri-state p/ a lista: `null` = ainda não resolvido (concluir bloqueado com
  // "Carregando…"); senão, o checkout resolvido (segmento OU entitlement).
  const checkoutState: boolean | null =
    paymentsFeature === null ? null : checkoutEnabled;
  // Linha de comissão só aparece quando o ramo libera (ex.: barbearia) E o papel
  // pode ler comissão (admin/professional; receptionist nunca). Defesa em
  // profundidade — a trava real do snapshot é o RLS financeiro da ADR-02.
  const showCommission = commissionFeature && canViewCommission;
  const { tenant, userId, role, subscriptionStatus } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const { servicosLabel, profissionaisLabel } = useSegmentTerms();

  const professionalsQuery = useProfessionals({ activeOnly: true });
  const servicesQuery = useServices({ activeOnly: true });
  const resourcesQuery = useResources({ activeOnly: true });

  // Dia inicial: o `?dia=YYYY-MM-DD` da URL (deep-link do painel operacional),
  // ou hoje no fuso do tenant. Lido só na montagem; a navegação interna segue
  // pelo estado, sem reescrever a URL.
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [day, setDay] = useState(() => {
    const fromUrl = searchParams.get("dia");
    return isValidIsoDate(fromUrl) ? fromUrl : todayInTenantTz(timeZone);
  });
  // Filtro de profissional livre (admin/recepção). Vazio = todos.
  const [filterProfessionalId, setFilterProfessionalId] = useState<string>("");
  // Filtro de serviço (todos os papéis). Vazio = todos os serviços.
  const [filterServiceId, setFilterServiceId] = useState<string>("");
  // Filtro de status do agendamento. Vazio = todos os status.
  const [filterStatus, setFilterStatus] = useState<AppointmentStatus | "">("");
  // Filtro por recursos (ids). Vazio = todos os recursos.
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  // Visão escolhida pelo usuário (lista/dia/semana), persistida no navegador.
  const [view, setView] = useAgendaView();

  // Profissional vinculado ao próprio login (quando `professional`).
  const ownProfessional = useMemo(() => {
    if (canScheduleForAnyProfessional) return null;
    if (!userId) return null;
    return (
      professionalsQuery.data?.find((p) => p.profile_id === userId) ?? null
    );
  }, [canScheduleForAnyProfessional, userId, professionalsQuery.data]);

  // Para o `professional`, a lista já chega filtrada pelo RLS; o filtro visível
  // some. Para admin/recepção, aplica o filtro escolhido (ou todos).
  const effectiveProfessionalId = canScheduleForAnyProfessional
    ? filterProfessionalId || undefined
    : (ownProfessional?.id ?? undefined);

  const appointmentsQuery = useAppointments({
    day,
    professionalId: effectiveProfessionalId,
    serviceId: filterServiceId || undefined,
    status: filterStatus || undefined,
  });

  // Base cheia do dia para o Resumo (ADR-02): mesmo dia + mesmo profissional,
  // SEM os recortes de UX (serviço/status). Evita o feedback loop em que ativar
  // "A confirmar" encolhia os KPIs para o subconjunto filtrado. A lista segue
  // com `appointmentsQuery` (filtrada); o resumo usa esta base cheia.
  const summaryBaseQuery = useAppointments({
    day,
    professionalId: effectiveProfessionalId,
  });

  // Intervalo da semana (segunda→domingo) que contém `day`, no fuso do tenant.
  // Mesma fonte única (`weekRangeOf`) que o `AgendaCalendarWeek` usa para montar
  // as colunas, então o intervalo buscado nunca diverge das colunas renderizadas.
  const weekRange = useMemo(() => weekRangeOf(day), [day]);

  // Busca os 7 dias numa única request, mas só na visão Semana (`enabled`). Dia
  // e Lista seguem no `useAppointments` por-dia acima. Os filtros de recorte
  // (profissional/serviço/status) refinam o conteúdo sem colapsar a grade; o
  // isolamento por tenant continua 100% no RLS.
  const weekQuery = useAppointmentsRange({
    startDay: weekRange?.start ?? day,
    endDay: weekRange?.end ?? day,
    professionalId: effectiveProfessionalId,
    serviceId: filterServiceId || undefined,
    status: filterStatus || undefined,
    enabled: view === "semana",
  });

  // Base cheia da semana para a % de ocupação (ADR-02 espelhado): mesmo
  // intervalo + mesmo profissional, SEM os recortes de UX (serviço/status).
  // Ativar um filtro encolhia o numerador sem encolher o denominador; a lista
  // segue com `weekQuery` (filtrada), a ocupação usa esta base cheia.
  const weekBaseQuery = useAppointmentsRange({
    startDay: weekRange?.start ?? day,
    endDay: weekRange?.end ?? day,
    professionalId: effectiveProfessionalId,
    enabled: view === "semana",
  });

  // Filtros de recorte ativos — distinguem o estado vazio "sem agendamentos
  // no dia" do "nada bate com os filtros". A declaração mora após
  // `paymentPendingOnly` (TDZ); ver `hasActiveFilters` abaixo.
  function clearFilters() {
    setFilterProfessionalId("");
    setFilterServiceId("");
    setFilterStatus("");
    setResourceIds([]);
    setPaymentPendingOnly(false);
  }

  /** Alterna o quick filter "A confirmar" (status=pendente). */
  function toggleAConfirmar() {
    setFilterStatus((current) => (current === "pendente" ? "" : "pendente"));
  }

  const changeStatus = useChangeAppointmentStatus();
  // Consumo T2.0 (ADR-07): confirmar dispara a régua existente (opt-in +
  // toggle + janela 24h); fora disso, silencioso. O lote (bulk) confirma sem
  // disparo (R9 rate limit) — só o 1-clique/individual consome a régua.
  const { maybeSendConfirmation } = useAutoSendConfirmation();

  // Lote sem endpoint batch (ADR-04): N chamadas à mutação existente, sem
  // rota `/bulk`/`/batch`. Só Confirmar/Cancelar (não financeiros —
  // receptionist incluído); Concluir e nao_compareceu exigem fluxo individual.
  const bulkSelection = useBulkSelection();
  const bulkTransition = useBulkTransition(async (call) => {
    await changeStatus.mutateAsync({
      id: call.id,
      from: call.from,
      to: call.to,
    });
  });
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);

  function bulkItems(): BulkTransitionItem[] {
    const byId = new Map(appointments.map((item) => [item.id, item]));
    return bulkSelection.selectedIds.flatMap((id) => {
      const found = byId.get(id);
      return found ? [{ id, from: found.status }] : [];
    });
  }

  /** Toast pós-lote: resumo parcial, sem Desfazer (lote irreversível — ADR-04). */
  function announceBulkSummary(
    summary: { ok: BulkTransitionItem[]; failed: { item: BulkTransitionItem }[] },
    actionLabel: string,
  ) {
    if (summary.failed.length === 0) {
      toast.success(`${summary.ok.length} ${actionLabel}.`);
      bulkSelection.clear();
      return;
    }
    if (summary.ok.length === 0) {
      toast.error("Nenhum item foi atualizado. Tente novamente.");
      return;
    }
    toast.warning(`${summary.ok.length} ok, ${summary.failed.length} falharam.`, {
      action: {
        label: "Repetir com falha",
        onClick: () => void handleBulkRetry(),
      },
      duration: 5000,
    });
  }

  async function handleBulkConfirm() {
    // Confirmar só é válido a partir de pendente (máquina de estados); o hook
    // marcaria o resto como falha sem rede, então pré-filtra com aviso.
    const eligible = bulkItems().filter((item) => item.from === "pendente");
    if (eligible.length === 0) {
      toast.error("Nenhum item selecionado pode ser confirmado.");
      return;
    }
    if (eligible.length < bulkSelection.count) {
      toast.warning("Só agendamentos pendentes entram no lote de confirmação.");
    }
    const summary = await bulkTransition.run(eligible, "confirmado");
    announceBulkSummary(summary, "agendamentos confirmados");
  }

  async function handleBulkCancelConfirmed() {
    // Cancelar vale de qualquer estado não-final; finais nem entram no lote.
    const eligible = bulkItems().filter(
      (item) => !isFinalStatus(item.from),
    );
    if (eligible.length === 0) {
      toast.error("Nenhum item selecionado pode ser cancelado.");
      setBulkCancelOpen(false);
      return;
    }
    setBulkCancelOpen(false);
    const summary = await bulkTransition.run(eligible, "cancelado");
    announceBulkSummary(summary, "agendamentos cancelados");
  }

  async function handleBulkRetry() {
    const summary = await bulkTransition.retry();
    if (summary) announceBulkSummary(summary, "agendamentos atualizados");
  }

  const [formOpen, setFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] =
    useState<AppointmentWithRelations | null>(null);
  const [statusChange, setStatusChange] = useState<{
    appointment: AppointmentWithRelations;
    to: AppointmentStatus;
  } | null>(null);
  const [captureTarget, setCaptureTarget] = useState<{
    appointment: AppointmentWithRelations;
    mode: "close" | "register";
  } | null>(null);
  const [settlementAppointmentId, setSettlementAppointmentId] = useState<
    string | null
  >(null);
  const [paymentPendingOnly, setPaymentPendingOnly] = useState(false);
  const [messageTarget, setMessageTarget] =
    useState<AppointmentWithRelations | null>(null);
  // Pré-preenchimento ao criar a partir de uma faixa vazia do calendário
  // ou de Duplicar (ADR-03: sugere o próximo slot livre, sem pagamento).
  const [prefill, setPrefill] = useState<{
    professionalId?: string;
    time?: string;
    customerId?: string;
    serviceId?: string;
    comboId?: string;
  } | null>(null);

  // Charge do depósito (Fase 4, ADR-12 / RF-06): só busca quando o drawer abre
  // um atendimento `aguardando_deposito`. Leitura escopada ao atendimento sob
  // RBAC (Edge `get-appointment-settlement`); fora disso, nada é buscado e o
  // drawer cai na dica ("cobrança aparece aqui assim que for gerada").
  // Follow-ups 🟡 (não bloqueantes): polling de status da charge, mascarar o
  // valor por papel (receptionist), skeleton com `entitled===null`, DevTools 375px.
  const depositTarget =
    formOpen && editingAppointment?.status === "aguardando_deposito"
      ? editingAppointment
      : null;
  const depositChargeQuery = useDepositCharge(depositTarget?.id ?? null);
  const depositCharge: DepositCharge | null = depositChargeQuery.data ?? null;

  /** Reenviar QR = recarregar a charge escopada (o disparo é a Edge). */
  async function handleResendDepositQr() {
    const refreshed = await depositChargeQuery.refetch();
    if (refreshed.isError) {
      toast.error("Não foi possível atualizar a cobrança. Tente novamente.");
    } else {
      toast.success("Cobrança atualizada.");
    }
  }

  /** Cancela a charge de depósito + atendimento (RPC `cancel_deposit_appointment`). */
  async function handleCancelDepositCharge() {
    if (!depositTarget || !tenant?.id || !userId) {
      toast.error("Não foi possível cancelar a cobrança. Tente novamente.");
      return;
    }
    const { error } = await supabase.rpc("cancel_deposit_appointment", {
      p_tenant_id: tenant.id,
      p_appointment_id: depositTarget.id,
      p_actor_id: userId,
      p_refund_policy: null,
    });
    if (error) {
      toast.error("Não foi possível cancelar a cobrança. Tente novamente.");
      return;
    }
    toast.success("Cobrança cancelada.");
    // Sem `useQueryClient` de propósito: os testes da página mockam os hooks e
    // não montam provider. O refetch escopado abaixo recarrega lista + resumo.
    void appointmentsQuery.refetch();
    void summaryBaseQuery.refetch();
    setFormOpen(false);
  }

  // Trocar de dia invalida a seleção do lote (ids de outro dia).
  useEffect(() => {
    bulkSelection.clear();
    bulkTransition.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  function openCreate() {
    setEditingAppointment(null);
    setPrefill(null);
    setFormOpen(true);
  }

  /**
   * Criar a partir de uma faixa vazia do calendário: pré-preenche profissional
   * (quando a coluna aponta um) + início e abre o diálogo. A não-sobreposição
   * segue sendo validada no submit (constraint do banco, ADR-06).
   */
  function openCreateAt(professionalId: string | null, time: string) {
    if (!canManageAppointments) return;
    setEditingAppointment(null);
    setPrefill({
      professionalId:
        professionalId ?? effectiveProfessionalId ?? undefined,
      time,
    });
    setFormOpen(true);
  }

  function openEdit(appointment: AppointmentWithRelations) {
    setEditingAppointment(appointment);
    setPrefill(null);
    setFormOpen(true);
  }

  /**
   * Duplicar (ADR-03): abre a criação pré-preenchida (mesmo cliente,
   * serviço/pacote e profissional) com o próximo slot livre sugerido. Nunca
   * copia pagamento, comprovante ou comissão — a criação parte do zero.
   */
  function openDuplicate(appointment: AppointmentWithRelations) {
    if (!canManageAppointments) return;
    const suggestion = suggestDuplicateSlot({
      appointment,
      dayAppointments: appointments,
      day,
      timeZone,
    });
    if (!suggestion) {
      toast.error("Sem horário livre hoje para duplicar. Ajuste o horário.");
    }
    setEditingAppointment(null);
    setPrefill({
      ...resolveDuplicatePrefill(appointment, suggestion),
    });
    setFormOpen(true);
  }

  /**
   * Transições sensíveis abrem o diálogo de confirmação; as demais aplicam
   * direto. A máquina de estados do banco é a trava — aqui é defesa de UX.
   */
  async function handleChangeStatus(
    appointment: AppointmentWithRelations,
    to: AppointmentStatus,
  ) {
    // Defesa em profundidade sobre o guard de rota (R10): assinatura travada
    // no meio da sessão bloqueia a escrita aqui e leva à quitação.
    if (subscriptionStatus === "bloqueado") {
      toast.error("Assinatura pendente. Regularize para continuar.");
      navigate("/app/quitacao");
      return;
    }
    if (subscriptionStatus === "cancelado") {
      toast.error("Conta cancelada. Fale com o suporte.");
      return;
    }
    if (to === "concluido") {
      // `null` = ainda não resolvido: nunca cair no fluxo legado (D5).
      if (paymentsFeature === null) return;
      // Sessão de pacote (ADR-06): já foi paga na venda; a baixa acontece no
      // mesmo commit via trigger — gerar PIX aqui seria dupla cobrança, então
      // pula o capture e cai no legado (que só anuncia a baixa).
      // O auto-vínculo do trigger (RF-12) invalida o guard acima: o vínculo é
      // gravado no concluir, então pré-concluir é sempre null na sessão do
      // pacote. Com crédito válido (SSoT do servidor), conclui direto sem
      // capture; sem crédito, capture normal. Falha de rede fail-open p/ capture.
      if (!appointment.package_credit_id && checkoutEnabled) {
        const covered = await hasValidPackageCredit(
          appointment.customer_id,
          appointment.service_id,
        );
        if (!covered) {
          setCaptureTarget({ appointment, mode: "close" });
          return;
        }
      }
    }
    if (SENSITIVE_TRANSITIONS.includes(to)) {
      setStatusChange({ appointment, to });
      return;
    }
    try {
      await changeStatus.mutateAsync({
        id: appointment.id,
        from: appointment.status,
        to,
      });
      // Consumo T2.0: só o confirmar individual tenta o disparo; o resto do
      // fluxo (status, PIX via PaymentCaptureDialog, comprovante) já é o
      // existente e segue intocado.
      if (to === "confirmado") {
        const outcome = await maybeSendConfirmation(appointment);
        if (outcome === "sent") {
          toast.success("Confirmado. Mensagem enviada no WhatsApp.");
        } else {
          toast.success("Status atualizado.");
          if (outcome === "failed") {
            toast.warning("Confirmado, mas a mensagem de WhatsApp não saiu.");
          }
        }
      } else {
        toast.success("Status atualizado.");
      }
    } catch (error) {
      toast.error(mapSchedulingError(error));
    }
  }

  // `professional` sem vínculo: não tem agenda própria. Estado vazio honesto em
  // vez de um formulário que o RLS recusaria.
  const professionalWithoutLink =
    !canScheduleForAnyProfessional &&
    !professionalsQuery.isLoading &&
    !professionalsQuery.isError &&
    !ownProfessional;

  const appointments = appointmentsQuery.data ?? [];
  const weekAppointments = weekQuery.data ?? [];
  const activeProfessionals = professionalsQuery.data ?? [];
  const activeServices = servicesQuery.data ?? [];

  const paymentFlagRows = view === "semana" ? weekAppointments : appointments;
  const agendaPaymentFlags = useAgendaPaymentFlags(paymentFlagRows, {
    enabled: checkoutEnabled && canViewFinancials,
  });

  const selectedResourceNames = (resourcesQuery.data ?? [])
    .filter((r) => resourceIds.includes(r.id))
    .map((r) => r.name);
  const visibleAppointments = (paymentPendingOnly
    ? appointments.filter((appointment) => {
        if (appointment.status !== "concluido") return false;
        const flag = agendaPaymentFlags.statusById.get(appointment.id);
        return flag !== undefined && flag !== "unknown" && flag !== "quitado";
      })
    : appointments
  ).filter((appointment) => {
    if (resourceIds.length === 0) return true;
    return (appointment.resources ?? []).some((r) =>
      selectedResourceNames.includes(r.name),
    );
  });

  /** Agrupamento da visão Lista por turno (manhã/tarde/noite) no fuso do tenant. */
  const appointmentsByPeriod = useMemo(() => {
    const groups = {
      manha: [] as typeof visibleAppointments,
      tarde: [] as typeof visibleAppointments,
      noite: [] as typeof visibleAppointments,
    };
    for (const appointment of visibleAppointments) {
      const hour = toTenantLocal(appointment.starts_at, timeZone).hour;
      if (hour < 12) groups.manha.push(appointment);
      else if (hour < 18) groups.tarde.push(appointment);
      else groups.noite.push(appointment);
    }
    return [
      { id: "manha", label: "Período da manhã", items: groups.manha },
      { id: "tarde", label: "Período da tarde", items: groups.tarde },
      { id: "noite", label: "Período da noite", items: groups.noite },
    ].filter((group) => group.items.length > 0);
  }, [visibleAppointments, timeZone]);

  // Resumo do dia (ADR-02) sobre a base cheia do dia — para `professional`, o
  // RLS já recortou a própria agenda. Capacidade `null`: o denominador de
  // ocupação ainda não tem fonte (follow-up ADR-05), então degrada para
  // "N agendados" sem % (contra da ADR-01). `role null` mascara (fail-closed).
  const daySummary = useMemo(
    () =>
      maskDaySummaryForRole(
        computeDaySummary(summaryBaseQuery.data ?? [], null),
        role ?? "receptionist",
      ),
    [summaryBaseQuery.data, role],
  );

  // Estado do resumo (independente da lista filtrada): carrega/erro da base
  // cheia, não do recorte. A lista segue com `dataQuery` abaixo.
  const summaryLoading =
    (canScheduleForAnyProfessional ? false : professionalsQuery.isLoading) ||
    summaryBaseQuery.isLoading;

  // Profissionais visíveis na Semana (corte grade×cards + denominador de
  // ocupação da ADR-05): filtro aplicado ou todos os ativos. `professional`
  // (agenda própria, já recortada pelo RLS) → só o vínculo.
  const weekProfessionals = useMemo(() => {
    if (!canScheduleForAnyProfessional) {
      return ownProfessional ? [ownProfessional] : [];
    }
    if (effectiveProfessionalId) {
      return activeProfessionals.filter((p) => p.id === effectiveProfessionalId);
    }
    return activeProfessionals;
  }, [
    canScheduleForAnyProfessional,
    ownProfessional,
    effectiveProfessionalId,
    activeProfessionals,
  ]);

  // Grade da lista visível (correção review ADR-05): um único `.in()` pelos
  // ids em foco, agregado para Dia e Semana. "Todos" somam cada grade real;
  // sem linha, o denominador cai no estimado (apoio já documenta). Dia usa a
  // janela de horas da união; Semana usa o denominador por profissional.
  // Semana reaproveita `weekProfessionals` (filtro aplicado ou todos).
  const workingHoursIds = useMemo(() => {
    if (view === "lista") return [];
    if (view === "semana") return weekProfessionals.map((p) => p.id);
    if (!canScheduleForAnyProfessional) {
      return ownProfessional ? [ownProfessional.id] : [];
    }
    if (effectiveProfessionalId) return [effectiveProfessionalId];
    return activeProfessionals.map((p) => p.id);
  }, [
    view,
    weekProfessionals,
    canScheduleForAnyProfessional,
    ownProfessional,
    effectiveProfessionalId,
    activeProfessionals,
  ]);
  const workingHoursManyQuery = useWorkingHoursMany(workingHoursIds);
  const aggregatedWorkingHours = workingHoursManyQuery.data ?? [];

  // Chips derivados do mesmo estado dos filtros (sem store nova).
  const filterChips = useMemo(() => {
    const chips: { key: string; rotulo: string }[] = [];
    if (canScheduleForAnyProfessional && filterProfessionalId) {
      chips.push({
        key: "professional",
        rotulo:
          activeProfessionals.find((p) => p.id === filterProfessionalId)?.name ??
          "Profissional",
      });
    }
    if (filterServiceId) {
      chips.push({
        key: "service",
        rotulo:
          activeServices.find((s) => s.id === filterServiceId)?.name ?? servicosLabel,
      });
    }
    if (filterStatus) {
      chips.push({ key: "status", rotulo: getAppointmentStatusLabel(filterStatus) });
    }
    if (paymentPendingOnly) {
      chips.push({ key: "paymentPending", rotulo: "Pagamento pendente" });
    }
    return chips;
  }, [
    canScheduleForAnyProfessional,
    filterProfessionalId,
    filterServiceId,
    filterStatus,
    paymentPendingOnly,
    activeProfessionals,
    activeServices,
    servicosLabel,
  ]);

  function removeFilterChip(key: string) {
    if (key === "professional") setFilterProfessionalId("");
    else if (key === "service") setFilterServiceId("");
    else if (key === "status") setFilterStatus("");
    else if (key === "paymentPending") setPaymentPendingOnly(false);
  }

  const todayIso = todayInTenantTz(timeZone);
  const tomorrowIso = shiftIsoDate(todayIso, 1);

  // Ver comentário em `clearFilters`: só aqui `paymentPendingOnly` já existe.
  const hasActiveFilters =
    !!filterServiceId ||
    !!filterStatus ||
    !!filterProfessionalId ||
    paymentPendingOnly;

  // Na Semana, o estado de dados (carregando/erro/refetch) vem do `weekQuery`;
  // Dia e Lista seguem com o `appointmentsQuery` por-dia. A base de profissionais
  // ainda bloqueia o render inicial para o `professional` (lista já filtrada
  // pelo RLS) em todas as visões.
  const dataQuery = view === "semana" ? weekQuery : appointmentsQuery;

  const isLoading =
    (canScheduleForAnyProfessional ? false : professionalsQuery.isLoading) ||
    dataQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Agenda"
        descricao="Agendamentos do dia por profissional."
        acoes={
          canManageAppointments && !professionalWithoutLink ? (
            <div className="flex flex-wrap gap-2">
              {checkoutEnabled && canRegisterPayments ? (
                <Button variant="outline" onClick={() => navigate("/app/pdv")}>
                  <ShoppingCart aria-hidden="true" />
                  Nova venda
                </Button>
              ) : null}
              <WaitlistCta entitled={waitlistEntitled} />
              <Button onClick={openCreate}>
                <Plus aria-hidden="true" />
                Novo agendamento
              </Button>
            </div>
          ) : undefined
        }
      />
      {/* Gating T1.1 (ADR-07): degrada para nada sem T1.x. */}
      <PlanBadge />

      {professionalWithoutLink ? (
        <StatePanel
          titulo="Sua agenda ainda não está configurada"
          descricao="Peça a um administrador para vincular o seu acesso a um profissional."
        />
      ) : (
        <>
          <ResumoDoDia
            summary={summaryBaseQuery.isError ? null : daySummary}
            isLoading={summaryLoading}
            isError={summaryBaseQuery.isError}
            onRetry={() => void summaryBaseQuery.refetch()}
            onSelectTodos={() => {
              setFilterStatus("");
              setPaymentPendingOnly(false);
            }}
            onSelectAConfirmar={() => setFilterStatus("pendente")}
            aConfirmarAtivo={filterStatus === "pendente"}
          />
          {/* Barra de filtro (ADR-02): navegação de data + quick filters
              (Hoje/Amanhã/Esta semana + A confirmar + view toggle) + botão
              "Filtros" (avançados em Dialog/Sheet). `flex-wrap` + larguras
              fluidas evitam overflow horizontal em 1280 px e 375 px. */}
          <div
            data-testid="agenda-filter-bar"
            className="sticky top-0 z-20 -mx-4 flex min-w-0 flex-col gap-3 bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:flex-row lg:flex-wrap lg:items-end lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
          >
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <div className="min-w-0 space-y-1">
                <label
                  htmlFor="agenda-dia"
                  className="text-sm font-medium text-foreground"
                >
                  Ir para data
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Dia anterior"
                    onClick={() => setDay((d) => shiftIsoDate(d, -1))}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Input
                    id="agenda-dia"
                    type="date"
                    className="w-auto"
                    aria-label="Ir para data"
                    value={day}
                    onChange={(event) => setDay(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Próximo dia"
                    onClick={() => setDay((d) => shiftIsoDate(d, 1))}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>

            <AgendaQuickFilters
              day={day}
              todayIso={todayIso}
              tomorrowIso={tomorrowIso}
              weekAtiva={view === "semana"}
              onSelectDay={setDay}
              onSelectWeek={() => {
                setDay(weekRange?.start ?? day);
                setView("semana");
              }}
              aConfirmarAtivo={filterStatus === "pendente"}
              onToggleAConfirmar={toggleAConfirmar}
              view={view}
              onViewChange={setView}
            />

            <div className="min-w-0 lg:ml-auto lg:shrink-0">
              <AgendaFilterPopover
                professionals={activeProfessionals}
                services={activeServices}
                resources={resourcesQuery.data ?? []}
                servicosLabel={servicosLabel}
                profissionaisLabel={profissionaisLabel}
                showProfessional={canScheduleForAnyProfessional}
                professionalId={filterProfessionalId}
                serviceId={filterServiceId}
                resourceIds={resourceIds}
                status={filterStatus}
                showPaymentPending={
                  view === "lista" &&
                  checkoutEnabled &&
                  canViewFinancials &&
                  agendaPaymentFlags.pendingCount > 0
                }
                paymentPendingOnly={paymentPendingOnly}
                pendingCount={agendaPaymentFlags.pendingCount}
                activeCount={filterChips.length}
                onChangeProfessional={setFilterProfessionalId}
                onChangeService={setFilterServiceId}
                onChangeResources={setResourceIds}
                onChangeStatus={setFilterStatus}
                onTogglePaymentPending={() =>
                  setPaymentPendingOnly((value) => !value)
                }
                onClearAll={clearFilters}
              />
            </div>
          </div>

          <AgendaFilterChips
            chips={filterChips}
            onRemove={removeFilterChip}
            onClearAll={clearFilters}
          />

          {isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : dataQuery.isError ? (
            <StatePanel
              titulo="Não foi possível carregar a agenda"
              descricao="Verifique sua conexão e tente novamente."
            >
              <Button
                variant="outline"
                onClick={() => void dataQuery.refetch()}
              >
                Tentar novamente
              </Button>
            </StatePanel>
          ) : view === "dia" ? (
            <AgendaCalendarDay
              day={day}
              timeZone={timeZone}
              appointments={appointments}
              professionals={activeProfessionals}
              singleColumn={!canScheduleForAnyProfessional || !!effectiveProfessionalId}
              workingHours={aggregatedWorkingHours}
              weekday={weekdayOf(day)}
              showCommission={showCommission}
              onOpenAppointment={canManageAppointments ? openEdit : () => {}}
              onCreateAt={canManageAppointments ? openCreateAt : undefined}
              paymentFlags={agendaPaymentFlags.statusById}
              onOpenPayment={
                checkoutEnabled
                  ? (appointment) => setSettlementAppointmentId(appointment.id)
                  : undefined
              }
              paymentsMessages={paymentsMessages}
              canRegisterPayments={
                checkoutEnabled && canRegisterPayments
              }
              quickActions={
                canManageAppointments
                  ? {
                      canManage: true,
                      paymentsFeature: checkoutState,
                      isChangingStatus: changeStatus.isPending,
                      onChangeStatus: (target, to) =>
                        void handleChangeStatus(target, to),
                      onEdit: openEdit,
                      onDuplicate: openDuplicate,
                    }
                  : undefined
              }
              movable={canManageAppointments}
            />
          ) : view === "semana" ? (
            <AgendaCalendarWeek
              day={day}
              timeZone={timeZone}
              appointments={weekAppointments}
              occupancyAppointments={weekBaseQuery.data ?? weekAppointments}
              todayIso={todayInTenantTz(timeZone)}
              showCommission={showCommission}
              onSelectDay={setDay}
              onOpenAppointment={canManageAppointments ? openEdit : () => {}}
              paymentFlags={agendaPaymentFlags.statusById}
              onOpenPayment={
                checkoutEnabled
                  ? (appointment) => setSettlementAppointmentId(appointment.id)
                  : undefined
              }
              paymentsMessages={paymentsMessages}
              canRegisterPayments={
                checkoutEnabled && canRegisterPayments
              }
              professionals={weekProfessionals}
              workingHours={aggregatedWorkingHours}
            />
          ) : view === "recurso" ? (
            <div data-testid="recurso-view" className="space-y-3">
              <ul className="space-y-3">
                {visibleAppointments.map((appointment) => (
                  <AgendaItem
                    key={appointment.id}
                    appointment={appointment}
                    timeZone={timeZone}
                    canManage={canManageAppointments}
                    canSendMessage={canSendWhatsAppMessage}
                    showCommission={showCommission}
                    paymentsState={checkoutState}
                    paymentFlag={agendaPaymentFlags.statusById.get(appointment.id)}
                    canRegisterPayments={canRegisterPayments}
                    onOpenPayment={(target) =>
                      setSettlementAppointmentId(target.id)
                    }
                    onEdit={openEdit}
                    onChangeStatus={handleChangeStatus}
                    onSendMessage={setMessageTarget}
                  />
                ))}
              </ul>
            </div>
          ) : appointments.length === 0 && hasActiveFilters ? (
            <StatePanel
              titulo="Nenhum agendamento com estes filtros."
              descricao="Ajuste ou limpe os filtros para ver mais agendamentos."
            >
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </StatePanel>
          ) : appointments.length === 0 ? (
            <StatePanel
              titulo="Nenhum agendamento para este dia"
              descricao={
                canManageAppointments
                  ? "Crie o primeiro agendamento deste dia."
                  : "Não há agendamentos marcados para este dia."
              }
            >
              {canManageAppointments ? (
                <Button onClick={openCreate}>
                  <Plus aria-hidden="true" />
                  Novo agendamento
                </Button>
              ) : null}
            </StatePanel>
          ) : (
            <>
              {canManageAppointments ? (
                <div className="space-y-1">
                  <BulkActionBar
                    selectedCount={bulkSelection.count}
                    canManage={canManageAppointments}
                    running={bulkTransition.running}
                    progress={bulkTransition.progress}
                    result={bulkTransition.result}
                    onConfirm={() => void handleBulkConfirm()}
                    onCancelRequest={() => setBulkCancelOpen(true)}
                    onRetry={() => void handleBulkRetry()}
                    onClear={bulkSelection.clear}
                  />
                  {bulkSelection.limitHit ? (
                    <p role="alert" className="text-sm text-destructive">
                      Máximo de 50 itens por lote. Refine a seleção.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-5">
                {appointmentsByPeriod.map((group) => (
                  <section
                    key={group.id}
                    aria-labelledby={`agenda-periodo-${group.id}`}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2 border-b border-border/70 pb-1.5">
                      <h2
                        id={`agenda-periodo-${group.id}`}
                        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {group.label} ({group.items.length})
                      </h2>
                    </div>
                    <ul className="flex flex-col gap-2.5">
                      {group.items.map((appointment) => (
                        <AgendaItem
                          key={appointment.id}
                          appointment={appointment}
                          timeZone={timeZone}
                          canManage={canManageAppointments}
                          canSendMessage={canSendWhatsAppMessage}
                          showCommission={showCommission}
                          paymentsState={checkoutState}
                          paymentFlag={agendaPaymentFlags.statusById.get(appointment.id)}
                          canRegisterPayments={canRegisterPayments}
                          onOpenPayment={(target) =>
                            setSettlementAppointmentId(target.id)
                          }
                          onEdit={openEdit}
                          onChangeStatus={handleChangeStatus}
                          onSendMessage={setMessageTarget}
                          selection={
                            canManageAppointments &&
                            !isFinalStatus(appointment.status)
                              ? {
                                  checked: bulkSelection.isSelected(appointment.id),
                                  onToggle: () =>
                                    bulkSelection.toggle(appointment.id),
                                }
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {canManageAppointments && !professionalWithoutLink ? (
        <AppointmentDrawer
          open={formOpen}
          onOpenChange={setFormOpen}
          appointment={editingAppointment}
          day={day}
          timeZone={timeZone}
          lockedProfessionalId={
            canScheduleForAnyProfessional ? null : (ownProfessional?.id ?? null)
          }
          dayAppointments={appointments}
          prefill={prefill}
          depositCharge={depositCharge}
          onResendDepositQr={() => void handleResendDepositQr()}
          onCancelDepositCharge={() => void handleCancelDepositCharge()}
        />
      ) : null}

      <StatusChangeConfirm
        change={statusChange}
        onClose={() => setStatusChange(null)}
      />

      <BulkStatusConfirm
        open={bulkCancelOpen}
        count={bulkSelection.count}
        confirming={bulkTransition.running}
        onClose={() => setBulkCancelOpen(false)}
        onConfirm={() => void handleBulkCancelConfirmed()}
      />

      {captureTarget ? (
        <PaymentCaptureDialog
          open
          mode={captureTarget.mode}
          appointment={{
            id: captureTarget.appointment.id,
            customerName: captureTarget.appointment.customers?.name ?? "",
            serviceName:
              captureTarget.appointment.combos?.name ??
              captureTarget.appointment.services?.name ??
              "",
            professionalName:
              captureTarget.appointment.professionals?.name ?? "",
            totalCents: captureTarget.appointment.price_cents,
            status: captureTarget.appointment.status,
          }}
          onOpenChange={(open) => {
            if (!open) setCaptureTarget(null);
          }}
          onCompleted={() => setCaptureTarget(null)}
        />
      ) : null}

      {settlementAppointmentId ? (
        <AppointmentSettlementDialog
          open
          appointmentId={settlementAppointmentId}
          onOpenChange={(open) => {
            if (!open) setSettlementAppointmentId(null);
          }}
          onRegisterPayment={() => {
            const id = settlementAppointmentId;
            const target = [...appointments, ...weekAppointments].find(
              (appointment) => appointment.id === id,
            );
            setSettlementAppointmentId(null);
            if (target) {
              setCaptureTarget({ appointment: target, mode: "register" });
            }
          }}
        />
      ) : null}

      {canSendWhatsAppMessage && messageTarget && messageTarget.customer_id ? (
        <SendMessageDialog
          open={!!messageTarget}
          onOpenChange={(open) => {
            if (!open) setMessageTarget(null);
          }}
          customerId={messageTarget.customer_id}
          customerName={messageTarget.customers?.name ?? "o cliente"}
          whatsappOptIn={messageTarget.customers?.whatsapp_opt_in ?? false}
          appointmentId={messageTarget.id}
        />
      ) : null}
    </div>
  );
}
