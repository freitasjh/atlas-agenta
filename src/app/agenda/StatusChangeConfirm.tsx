import * as React from "react";

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
import { PixQrPanel } from "@/app/agenda/pagamentos/PixQrPanel";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

import {
  mapSchedulingError,
  useChangeAppointmentStatus,
} from "@/hooks/useAppointments";
import { useCreateCharge } from "@/hooks/useCharges";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
 * são aplicadas direto pela agenda, sem este diálogo.
 *
 * Caminho legado (`payments === false`, ex.: clínica): ao concluir, gera a
 * cobrança PIX e exibe o QR **no mesmo diálogo** — o markup duplicado de QR foi
 * removido em favor do `PixQrPanel` compartilhado (ADR-004 FE-21).
 */
export function StatusChangeConfirm({
  change,
  onClose,
}: StatusChangeConfirmProps) {
  const changeStatus = useChangeAppointmentStatus();
  const createCharge = useCreateCharge();
  const { canViewCommission } = usePermissions();
  const { commission: commissionFeature } = useSegmentFeatures();
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const [chargeResult, setChargeResult] = React.useState<{
    pix_qr_code: string | null;
    pix_copy_paste: string | null;
    expires_at: string | null;
    amount_cents: number;
  } | null>(null);

  const qrPhase = chargeResult !== null;

  // Aviso de comissão só ao concluir, e só para quem veria o valor depois
  // (ramo libera + papel pode ler).
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
          setChargeResult({
            pix_qr_code: res.pix_qr_code,
            pix_copy_paste: res.pix_copy_paste,
            expires_at: res.expires_at,
            amount_cents: res.amount_cents,
          });
          return;
        } catch {
          // Cobrança é opcional e não bloqueia a conclusão, mas a falha não é
          // silenciosa: o atendimento já foi concluído e a cobrança não saiu.
          toast.warning(
            "Atendimento concluído, mas a cobrança PIX não foi gerada.",
          );
        }
      }
      onClose();
    } catch (error) {
      toast.error(mapSchedulingError(error));
      onClose();
    }
  }

  function handleOpenChange(next: boolean) {
    if (next) return;
    setChargeResult(null);
    onClose();
  }

  return (
    <Dialog open={!!change || qrPhase} onOpenChange={handleOpenChange}>
      <DialogContent className={qrPhase ? "max-w-md" : undefined}>
        <DialogHeader>
          <DialogTitle>
            {qrPhase
              ? paymentsMessages.pix.generatedTitle
              : change
                ? `Mudar para "${getTransitionLabel(change.to)}"`
                : "Mudar status"}
          </DialogTitle>
          <DialogDescription>
            {qrPhase
              ? paymentsMessages.pix.dialogDescription
              : change
                ? CONSEQUENCE_COPY[change.to]
                : null}
          </DialogDescription>
        </DialogHeader>

        {qrPhase ? (
          <PixQrPanel
            qrCode={chargeResult?.pix_qr_code ?? null}
            copyPaste={chargeResult?.pix_copy_paste ?? null}
            expiresAt={chargeResult?.expires_at ?? null}
            amountCents={chargeResult?.amount_cents ?? 0}
            messages={paymentsMessages}
            timeZone={timeZone}
            onCopyResult={(result) => {
              if (result === "ok") toast.success(paymentsMessages.actions.copied);
              else toast.error(paymentsMessages.actions.copyFailed);
            }}
          />
        ) : (
          <>
            {showCommissionNote ? (
              <p className="text-sm text-muted-foreground">
                A comissão do profissional será apurada e registrada ao concluir.
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenChange.bind(null, false)}
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
          </>
        )}

        {qrPhase ? (
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setChargeResult(null);
                onClose();
              }}
            >
              {paymentsMessages.actions.close}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
