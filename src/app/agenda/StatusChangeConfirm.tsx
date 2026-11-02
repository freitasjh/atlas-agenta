import * as React from "react";

import { Loader2, Copy } from "lucide-react";
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
import { Input } from "@/components/ui/input";

import {
  mapSchedulingError,
  useChangeAppointmentStatus,
} from "@/hooks/useAppointments";
import { useCreateCharge } from "@/hooks/useCharges";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
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
  const createCharge = useCreateCharge();
  const { canViewCommission } = usePermissions();
  const { commission: commissionFeature } = useSegmentFeatures();
  const [chargeResult, setChargeResult] = React.useState<{
    pix_qr_code?: string | null;
    pix_copy_paste?: string | null;
    expires_at?: string;
  } | null>(null);

  // Aviso de comissão só ao concluir, e só para quem veria o valor depois
  // (ramo libera + papel pode ler). Honesto: a comissão é apurada e registrada
  // pelo banco ao concluir (trigger da ADR-03) — não promete nada além disso.
  const showCommissionNote =
    change?.to === "concluido" && commissionFeature && canViewCommission;

  async function confirm() {
    if (!change) return;
    try {
      await changeStatus.mutateAsync({
        id: change.appointment.id,
        from: change.appointment.status,
        to: change.to,
      });
      toast.success("Status atualizado.");
      if (change.to === "concluido") {
        try {
          const res = await createCharge.mutateAsync({
            appointment_id: change.appointment.id,
          });
          setChargeResult(res);
          // não fechar ainda: exibir QR
          return;
        } catch {
          // cobrança opcional; não bloqueia a conclusão
        }
      }
      onClose();
    } catch (error) {
      toast.error(mapSchedulingError(error));
      onClose();
    }
  }

  return (
    <>
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
        {showCommissionNote ? (
          <p className="text-sm text-muted-foreground">
            A comissão do profissional será apurada e registrada ao concluir.
          </p>
        ) : null}
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

    <Dialog
      open={!!chargeResult}
      onOpenChange={(next) => {
        if (!next) {
          setChargeResult(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cobrança PIX gerada</DialogTitle>
          <DialogDescription>
            Exiba o QR Code ou copie o código para o cliente.
          </DialogDescription>
        </DialogHeader>
        {chargeResult?.pix_qr_code ? (
          <div className="flex justify-center">
            <img
              src={
                chargeResult.pix_qr_code.startsWith("data:")
                  ? chargeResult.pix_qr_code
                  : `data:image/png;base64,${chargeResult.pix_qr_code}`
              }
              alt="QR Code PIX"
              className="h-40 w-40"
            />
          </div>
        ) : null}
        <div className="flex gap-2">
          <Input readOnly value={chargeResult?.pix_copy_paste ?? ""} />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={async () => {
              if (chargeResult?.pix_copy_paste) {
                try {
                  await navigator.clipboard.writeText(chargeResult.pix_copy_paste);
                  toast.success("Código copiado.");
                } catch {
                  toast.error("Não foi possível copiar.");
                }
              }
            }}
            aria-label="Copiar"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              setChargeResult(null);
              onClose();
            }}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
