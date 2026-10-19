import * as React from "react";
import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Pencil,
  Plus,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { SendMessageDialog } from "@/app/whatsapp/SendMessageDialog";
import { StatusBadge } from "@/components/StatusBadge";
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
import {
  mapSchedulingError,
  useAppointments,
  useChangeAppointmentStatus,
} from "@/hooks/useAppointments";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useProfile } from "@/hooks/useProfile";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatTimeInTenantTz } from "@/lib/datetime";
import { formatCentsToBRL } from "@/lib/money";
import {
  getAllowedTransitions,
  getTransitionLabel,
  isFinalStatus,
  SENSITIVE_TRANSITIONS,
} from "@/lib/scheduling-status";
import type {
  AppointmentStatus,
  AppointmentWithRelations,
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

/** Borda-lateral de status na timeline (reforço redundante do `StatusBadge`). */
const STATUS_BORDER: Record<AppointmentStatus, string> = {
  pendente: "border-status-pendente",
  confirmado: "border-status-confirmado",
  em_atendimento: "border-status-em-atendimento",
  concluido: "border-status-concluido",
  cancelado: "border-status-cancelado",
  nao_compareceu: "border-status-nao-compareceu",
};

/** Painel de estado (vazio/erro), no mesmo molde das demais telas de `/app`. */
function StatePanel({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      {children ? (
        <div className="mt-4 flex justify-center">{children}</div>
      ) : null}
    </div>
  );
}

/** Um item da timeline do dia. */
function AgendaItem({
  appointment,
  timeZone,
  canManage,
  canSendMessage,
  onEdit,
  onChangeStatus,
  onSendMessage,
}: {
  appointment: AppointmentWithRelations;
  timeZone: string;
  canManage: boolean;
  canSendMessage: boolean;
  onEdit: (appointment: AppointmentWithRelations) => void;
  onChangeStatus: (
    appointment: AppointmentWithRelations,
    to: AppointmentStatus,
  ) => void;
  onSendMessage: (appointment: AppointmentWithRelations) => void;
}) {
  const transitions = getAllowedTransitions(appointment.status);
  const showStatusMenu =
    canManage && !isFinalStatus(appointment.status) && transitions.length > 0;
  // Opt-in na borda: sem consentimento, a ação fica desabilitada com o motivo
  // em texto (defesa dupla; a trava real é o servidor).
  const optIn = appointment.customers?.whatsapp_opt_in ?? false;

  return (
    <li
      className={`rounded-lg border border-border border-l-2 ${STATUS_BORDER[appointment.status]} bg-card p-4`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <div className="shrink-0 font-display text-sm font-semibold tabular-nums text-foreground">
            {formatTimeInTenantTz(appointment.starts_at, timeZone)}
            <span className="text-muted-foreground">
              {"–"}
              {formatTimeInTenantTz(appointment.ends_at, timeZone)}
            </span>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              {appointment.customers?.name ?? "Cliente removido"}
            </p>
            <p className="text-sm text-muted-foreground">
              {appointment.services?.name ?? "Serviço removido"}
              {" · "}
              {appointment.professionals?.name ?? "Profissional removido"}
            </p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatCentsToBRL(appointment.price_cents)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          <StatusBadge status={appointment.status} />
          {canManage ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(appointment)}
              >
                <Pencil aria-hidden="true" />
                Editar
              </Button>
              {canSendMessage ? (
                <div className="flex flex-col items-start">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!optIn}
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
                    {transitions.map((to) => (
                      <DropdownMenuItem
                        key={to}
                        onSelect={() => onChangeStatus(appointment, to)}
                      >
                        {getTransitionLabel(to)}
                      </DropdownMenuItem>
                    ))}
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
  } = usePermissions();
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const { data: profile } = useProfile();
  const professionalsQuery = useProfessionals({ activeOnly: true });

  const [day, setDay] = useState(() => todayInTenantTz(timeZone));
  // Filtro de profissional livre (admin/recepção). Vazio = todos.
  const [filterProfessionalId, setFilterProfessionalId] = useState<string>("");

  // Profissional vinculado ao próprio login (quando `professional`).
  const ownProfessional = useMemo(() => {
    if (canScheduleForAnyProfessional) return null;
    if (!profile) return null;
    return (
      professionalsQuery.data?.find((p) => p.profile_id === profile.id) ?? null
    );
  }, [canScheduleForAnyProfessional, profile, professionalsQuery.data]);

  // Para o `professional`, a lista já chega filtrada pelo RLS; o filtro visível
  // some. Para admin/recepção, aplica o filtro escolhido (ou todos).
  const effectiveProfessionalId = canScheduleForAnyProfessional
    ? filterProfessionalId || undefined
    : (ownProfessional?.id ?? undefined);

  const appointmentsQuery = useAppointments({
    day,
    professionalId: effectiveProfessionalId,
  });

  const changeStatus = useChangeAppointmentStatus();

  const [formOpen, setFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] =
    useState<AppointmentWithRelations | null>(null);
  const [statusChange, setStatusChange] = useState<{
    appointment: AppointmentWithRelations;
    to: AppointmentStatus;
  } | null>(null);
  const [messageTarget, setMessageTarget] =
    useState<AppointmentWithRelations | null>(null);

  function openCreate() {
    setEditingAppointment(null);
    setFormOpen(true);
  }

  function openEdit(appointment: AppointmentWithRelations) {
    setEditingAppointment(appointment);
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
  const activeProfessionals = professionalsQuery.data ?? [];

  const isLoading =
    (canScheduleForAnyProfessional
      ? false
      : professionalsQuery.isLoading) || appointmentsQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Agenda"
        descricao="Agendamentos do dia por profissional."
        acoes={
          canManageAppointments && !professionalWithoutLink ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo agendamento
            </Button>
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
          {/* Barra de filtro: dia + profissional (oculto para professional) */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label
                  htmlFor="agenda-dia"
                  className="text-sm font-medium text-foreground"
                >
                  Dia
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
              <div className="space-y-1">
                <label
                  htmlFor="agenda-profissional"
                  className="text-sm font-medium text-foreground"
                >
                  Profissional
                </label>
                <Select
                  value={filterProfessionalId || "todos"}
                  onValueChange={(value) =>
                    setFilterProfessionalId(value === "todos" ? "" : value)
                  }
                >
                  <SelectTrigger
                    id="agenda-profissional"
                    className="w-[220px]"
                    aria-label="Filtrar por profissional"
                  >
                    <SelectValue placeholder="Todos os profissionais" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">
                      Todos os profissionais
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
          </div>

          {isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : appointmentsQuery.isError ? (
            <StatePanel
              titulo="Não foi possível carregar a agenda"
              descricao="Verifique sua conexão e tente novamente."
            >
              <Button
                variant="outline"
                onClick={() => void appointmentsQuery.refetch()}
              >
                Tentar novamente
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
              {appointments.map((appointment) => (
                <AgendaItem
                  key={appointment.id}
                  appointment={appointment}
                  timeZone={timeZone}
                  canManage={canManageAppointments}
                  canSendMessage={canSendWhatsAppMessage}
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
        />
      ) : null}

      <StatusChangeConfirm
        change={statusChange}
        onClose={() => setStatusChange(null)}
      />

      {canSendWhatsAppMessage && messageTarget ? (
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
