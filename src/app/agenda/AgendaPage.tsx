import { useId, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { toast } from "sonner";

import { AppointmentFormDialog } from "@/app/agenda/AppointmentFormDialog";
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
import {
  AgendaViewToggle,
  useAgendaView,
} from "@/app/agenda/AgendaViewToggle";
import {
  mapSchedulingError,
  useAppointments,
  useAppointmentsRange,
  useChangeAppointmentStatus,
} from "@/hooks/useAppointments";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useServices } from "@/hooks/useServices";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSegmentTerms } from "@/hooks/useSegmentTerms";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import {
  useAgendaPaymentFlags,
  type AgendaPaymentFlag,
} from "@/hooks/useAgendaPaymentFlags";
import { useWorkingHours } from "@/hooks/useWorkingHours";
import { formatTimeInTenantTz, weekRangeOf } from "@/lib/datetime";
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
  APPOINTMENT_STATUSES,
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

/** Borda-lateral de status na timeline (reforço redundante do `StatusBadge`). */
const STATUS_BORDER: Record<AppointmentStatus, string> = {
  pendente: "border-status-pendente",
  confirmado: "border-status-confirmado",
  em_atendimento: "border-status-em-atendimento",
  concluido: "border-status-concluido",
  cancelado: "border-status-cancelado",
  nao_compareceu: "border-status-nao-compareceu",
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
      className={`rounded-lg border border-border border-l-2 ${STATUS_BORDER[appointment.status]} bg-card p-4`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="shrink-0 font-display text-sm font-semibold tabular-nums text-foreground">
            {formatTimeInTenantTz(appointment.starts_at, timeZone)}
            <span className="text-muted-foreground">
              {"–"}
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
  // Linha de comissão só aparece quando o ramo libera (ex.: barbearia) E o papel
  // pode ler comissão (admin/professional; receptionist nunca). Defesa em
  // profundidade — a trava real do snapshot é o RLS financeiro da ADR-02.
  const showCommission = commissionFeature && canViewCommission;
  const { tenant, userId } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const { servicosLabel, profissionaisLabel } = useSegmentTerms();
  const servicosLower = servicosLabel.toLowerCase();
  const profissionaisLower = profissionaisLabel.toLowerCase();

  const professionalsQuery = useProfessionals({ activeOnly: true });
  const servicesQuery = useServices({ activeOnly: true });

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

  // Filtros de recorte ativos (serviço/status) — para distinguir o estado vazio
  // "sem agendamentos no dia" do "nada bate com os filtros".
  const hasActiveFilters = !!filterServiceId || !!filterStatus;

  function clearFilters() {
    setFilterServiceId("");
    setFilterStatus("");
  }

  // Grade do profissional em foco, só para desenhar a faixa de expediente na
  // visão Dia. Quando "todos" estão à vista (sem um profissional em foco), a
  // janela de horas é derivada dos próprios agendamentos.
  const workingHoursQuery = useWorkingHours(effectiveProfessionalId ?? null);

  const changeStatus = useChangeAppointmentStatus();

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
  // Pré-preenchimento ao criar a partir de uma faixa vazia do calendário.
  const [prefill, setPrefill] = useState<{
    professionalId?: string;
    time?: string;
  } | null>(null);

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
   * Transições sensíveis abrem o diálogo de confirmação; as demais aplicam
   * direto. A máquina de estados do banco é a trava — aqui é defesa de UX.
   */
  async function handleChangeStatus(
    appointment: AppointmentWithRelations,
    to: AppointmentStatus,
  ) {
    if (to === "concluido") {
      // `null` = ainda não resolvido: nunca cair no fluxo legado (D5).
      if (paymentsFeature === null) return;
      if (paymentsFeature === true) {
        setCaptureTarget({ appointment, mode: "close" });
        return;
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
      toast.success("Status atualizado.");
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
    enabled: paymentsFeature === true && canViewFinancials,
  });

  const visibleAppointments = paymentPendingOnly
    ? appointments.filter((appointment) => {
        if (appointment.status !== "concluido") return false;
        const flag = agendaPaymentFlags.statusById.get(appointment.id);
        return flag !== undefined && flag !== "unknown" && flag !== "quitado";
      })
    : appointments;

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
              {paymentsFeature === true && canRegisterPayments ? (
                <Button variant="outline" onClick={() => navigate("/app/pdv")}>
                  <ShoppingCart aria-hidden="true" />
                  Nova venda
                </Button>
              ) : null}
              <Button onClick={openCreate}>
                <Plus aria-hidden="true" />
                Novo agendamento
              </Button>
            </div>
          ) : undefined
        }
      />

      {professionalWithoutLink ? (
        <StatePanel
          titulo="Sua agenda ainda não está configurada"
          descricao="Peça a um administrador para vincular o seu acesso a um profissional."
        />
      ) : (
        <>
          {/* Barra de filtro: dia + profissional (oculto para professional).
              `flex-wrap` + larguras fluidas evitam overflow horizontal em
              1280 px (RNF-02): os controles quebram linha em vez de esticar
              o documento — nenhum controle é escondido. */}
          <div
            data-testid="agenda-filter-bar"
            className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end"
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDay(todayInTenantTz(timeZone))}
              >
                <CalendarDays aria-hidden="true" />
                Hoje
              </Button>
            </div>

            {canScheduleForAnyProfessional ? (
              <div
                data-testid="agenda-filter-professional"
                className="min-w-0 space-y-1 lg:w-[220px] lg:shrink-0"
              >
                <label
                  htmlFor="agenda-profissional"
                  className="text-sm font-medium text-foreground"
                >
                  {profissionaisLabel}
                </label>
                <Select
                  value={filterProfessionalId || "todos"}
                  onValueChange={(value) =>
                    setFilterProfessionalId(value === "todos" ? "" : value)
                  }
                >
                  <SelectTrigger
                    id="agenda-profissional"
                    className="w-full"
                    aria-label={`Filtrar por ${profissionaisLower}`}
                  >
                    <SelectValue
                      placeholder={`Todos (${profissionaisLower})`}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">
                      {`Todos (${profissionaisLower})`}
                    </SelectItem>
                    {activeProfessionals.map((professional) => (
                      <SelectItem key={professional.id} value={professional.id}>
                        {professional.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div
              data-testid="agenda-filter-service"
              className="min-w-0 space-y-1 lg:w-[200px] lg:shrink-0"
            >
              <label
                htmlFor="agenda-servico"
                className="text-sm font-medium text-foreground"
              >
                {servicosLabel}
              </label>
              <Select
                value={filterServiceId || "todos"}
                onValueChange={(value) =>
                  setFilterServiceId(value === "todos" ? "" : value)
                }
              >
                <SelectTrigger
                  id="agenda-servico"
                  className="w-full"
                  aria-label={`Filtrar por ${servicosLower}`}
                >
                  <SelectValue placeholder={`Todos (${servicosLower})`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">{`Todos (${servicosLower})`}</SelectItem>
                  {activeServices.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              data-testid="agenda-filter-status"
              className="min-w-0 space-y-1 lg:w-[200px] lg:shrink-0"
            >
              <label
                htmlFor="agenda-status"
                className="text-sm font-medium text-foreground"
              >
                Status
              </label>
              <Select
                value={filterStatus || "todos"}
                onValueChange={(value) =>
                  setFilterStatus(
                    value === "todos" ? "" : (value as AppointmentStatus),
                  )
                }
              >
                <SelectTrigger
                  id="agenda-status"
                  className="w-full"
                  aria-label="Filtrar por status"
                >
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  {APPOINTMENT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {getAppointmentStatusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {view === "lista" &&
            paymentsFeature === true &&
            canViewFinancials &&
            agendaPaymentFlags.pendingCount > 0 ? (
              <Button
                type="button"
                variant={paymentPendingOnly ? "default" : "outline"}
                size="sm"
                aria-pressed={paymentPendingOnly}
                aria-label={paymentsMessages.agenda.filterPendingAria}
                onClick={() => setPaymentPendingOnly((value) => !value)}
                className="min-h-[44px]"
              >
                {formatMessage(paymentsMessages.agenda.filterPending, {
                  count: agendaPaymentFlags.pendingCount,
                })}
              </Button>
            ) : null}

            <div className="min-w-0 lg:ml-auto lg:shrink-0">
              <AgendaViewToggle value={view} onChange={setView} />
            </div>
          </div>

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
              workingHours={workingHoursQuery.data ?? []}
              weekday={weekdayOf(day)}
              showCommission={showCommission}
              onOpenAppointment={canManageAppointments ? openEdit : () => {}}
              onCreateAt={canManageAppointments ? openCreateAt : undefined}
              paymentFlags={agendaPaymentFlags.statusById}
              onOpenPayment={
                paymentsFeature === true
                  ? (appointment) => setSettlementAppointmentId(appointment.id)
                  : undefined
              }
              paymentsMessages={paymentsMessages}
              canRegisterPayments={
                paymentsFeature === true && canRegisterPayments
              }
            />
          ) : view === "semana" ? (
            <AgendaCalendarWeek
              day={day}
              timeZone={timeZone}
              appointments={weekAppointments}
              todayIso={todayInTenantTz(timeZone)}
              showCommission={showCommission}
              onSelectDay={setDay}
              onOpenAppointment={canManageAppointments ? openEdit : () => {}}
              paymentFlags={agendaPaymentFlags.statusById}
              onOpenPayment={
                paymentsFeature === true
                  ? (appointment) => setSettlementAppointmentId(appointment.id)
                  : undefined
              }
              paymentsMessages={paymentsMessages}
              canRegisterPayments={
                paymentsFeature === true && canRegisterPayments
              }
            />
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
            <ul className="space-y-3">
              {visibleAppointments.map((appointment) => (
                <AgendaItem
                  key={appointment.id}
                  appointment={appointment}
                  timeZone={timeZone}
                  canManage={canManageAppointments}
                  canSendMessage={canSendWhatsAppMessage}
                  showCommission={showCommission}
                  paymentsState={paymentsFeature}
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
          )}
        </>
      )}

      {canManageAppointments && !professionalWithoutLink ? (
        <AppointmentFormDialog
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
        />
      ) : null}

      <StatusChangeConfirm
        change={statusChange}
        onClose={() => setStatusChange(null)}
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
