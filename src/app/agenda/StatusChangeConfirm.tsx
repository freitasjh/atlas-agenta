import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import {
  mapSchedulingError,
  useChangeAppointmentStatus,
} from "@/hooks/useAppointments";
import { getTransitionLabel } from "@/lib/scheduling-status";
import type {
  AppointmentStatus,
  AppointmentWithRelations,
} from "@/types/domain";

interface StatusChange {
  appointment: AppointmentWithRelations;
  to: AppointmentStatus;
}

interface StatusChangeConfirmProps {
  /** Transição sensível pendente de confirmação; `null` fecha o diálogo. */
  change: StatusChange | null;
  onClose: () => void;
}

/** Copy pt-BR explicando a consequência de cada transição sensível. */
const CONSEQUENCE_COPY: Partial<Record<AppointmentStatus, string>> = {
  concluido:
    "O atendimento será marcado como concluído. Esta é uma etapa final e não poderá ser desfeita.",
  cancelado:
    "O agendamento será cancelado e liberará o horário do profissional. Esta é uma etapa final.",
  nao_compareceu:
    "O agendamento será marcado como não comparecido. Esta é uma etapa final.",
};

/**
 * Confirmação de transição **sensível** (`concluido`, `cancelado`,
 * `nao_compareceu`) com copy pt-BR da consequência. As transições não-sensíveis
 * são aplicadas direto pela agenda, sem este diálogo. A trava real da máquina de
 * estados é o trigger do banco — esta tela é defesa de usabilidade.
 */
export function StatusChangeConfirm({
  change,
  onClose,
}: StatusChangeConfirmProps) {
  const changeStatus = useChangeAppointmentStatus();

  async function confirm() {
    if (!change) return;
    try {
      await changeStatus.mutateAsync({
        id: change.appointment.id,
        from: change.appointment.status,
        to: change.to,
      });
      // GANCHO (fase financeira): ao concluir, gerar cobrança PIX via Asaas.
      toast.success("Status atualizado.");
      onClose();
    } catch (error) {
      toast.error(mapSchedulingError(error));
      onClose();
    }
  }

  return (
    <Dialog
      open={!!change}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {change
              ? `Mudar para "${getTransitionLabel(change.to)}"`
              : "Mudar status"}
          </DialogTitle>
          <DialogDescription>
            {change ? CONSEQUENCE_COPY[change.to] : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={changeStatus.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={changeStatus.isPending}
          >
            {changeStatus.isPending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Aplicando…
              </>
            ) : (
              "Confirmar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
