import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineConfirmStep } from "@/app/agenda/pagamentos/InlineConfirmStep";
import { PendingChargeCard } from "@/app/agenda/pagamentos/PendingChargeCard";
import { PixQrPanel } from "@/app/agenda/pagamentos/PixQrPanel";
import { SettlementPaymentRow } from "@/app/agenda/pagamentos/SettlementPaymentRow";
import { paymentErrorMessage } from "@/app/agenda/pagamentos/payment-error-message";
import {
  formatMessage,
  paymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";
import {
  useAppointmentSettlement,
  useCancelCharge,
  useConfirmManualCharge,
  useVoidAppointmentPayment,
} from "@/hooks/useAppointmentPayments";
import { useCreateCharge } from "@/hooks/useCharges";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { PaymentApiError, parsePaymentError } from "@/lib/payment-errors";
import { formatCentsToBRL } from "@/lib/money";
import { formatDateInTenantTz } from "@/lib/datetime";
import type { PendingCharge, PixCharge, StaleCharge } from "@/types/payments";
import type { SettlementPhase } from "./payment-types";

export interface AppointmentSettlementDialogProps {
  open: boolean;
  appointmentId: string;
  onOpenChange: (open: boolean) => void;
  onRegisterPayment?: () => void;
}

const messages = paymentsMessages;

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function toPixCharge(charge: {
  id: string;
  amount_cents: number;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  expires_at: string | null;
}): PixCharge {
  return {
    id: charge.id,
    amount_cents: charge.amount_cents,
    pix_qr_code: charge.pix_qr_code,
    pix_copy_paste: charge.pix_copy_paste,
    expires_at: charge.expires_at,
  };
}

/**
 * Shell do settlement de **um** atendimento (ADR-004 §3/§10). Ações efetivas =
 * flag do servidor **E** capacidade do cliente. A confirmação é sempre um
 * `InlineConfirmStep` no mesmo diálogo; o QR é renderizado inline, nunca em
 * outro `Dialog`.
 */
export function AppointmentSettlementDialog({
  open,
  appointmentId,
  onOpenChange,
  onRegisterPayment,
}: AppointmentSettlementDialogProps) {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const permissions = usePermissions();

  const [phase, setPhase] = React.useState<SettlementPhase>({ kind: "ready" });
  const [reason, setReason] = React.useState("");
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [refundWarning, setRefundWarning] = React.useState(false);
  const [qrCharge, setQrCharge] = React.useState<PixCharge | null>(null);

  const settlementQuery = useAppointmentSettlement(
    open ? appointmentId : null,
    { enabled: open },
  );
  const cancelCharge = useCancelCharge();
  const confirmManual = useConfirmManualCharge();
  const voidPayment = useVoidAppointmentPayment();
  const createCharge = useCreateCharge();

  const settlement = settlementQuery.data ?? null;
  const pendingCharges = settlement?.pending_charges ?? [];
  const staleCharges = settlement?.stale_charges ?? [];

  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: "ready" });
      setReason("");
      setInlineError(null);
      setRefundWarning(false);
      setQrCharge(null);
    }
  }, [open]);

  const busy =
    cancelCharge.isPending || confirmManual.isPending || voidPayment.isPending;

  const canRegister =
    !!settlement?.permissions.can_register && permissions.canRegisterPayments;
  const canCancel =
    !!settlement?.permissions.can_cancel_charge && permissions.canCancelCharge;
  const canManual =
    !!settlement?.permissions.can_confirm_manual &&
    permissions.canConfirmChargeManual;
  const canVoid =
    !!settlement?.permissions.can_void && permissions.canVoidPayment;
  const canReissue =
    !!settlement?.permissions.can_reissue_pix &&
    permissions.canRegisterPayments;
  const canViewQr = !!settlement?.permissions.can_view_qr;

  function handleOpenChange(next: boolean) {
    if (!next && busy) return;
    onOpenChange(next);
  }

  function handleError(error: unknown) {
    const api = error instanceof PaymentApiError ? error : parsePaymentError(error);
    setInlineError(paymentErrorMessage(messages, api.code));
  }

  async function confirmCancel(chargeId: string) {
    setInlineError(null);
    try {
      await cancelCharge.mutateAsync({ chargeId, force: false });
      setPhase({ kind: "ready" });
    } catch (error) {
      handleError(error);
      setPhase({ kind: "ready" });
    }
  }

  async function confirmManualBaixa(chargeId: string) {
    setInlineError(null);
    try {
      await confirmManual.mutateAsync({ chargeId });
      setPhase({ kind: "ready" });
    } catch (error) {
      handleError(error);
      setPhase({ kind: "ready" });
    }
  }

  async function confirmVoid(paymentId: string) {
    if (!reason.trim()) return;
    setInlineError(null);
    try {
      const result = await voidPayment.mutateAsync({ paymentId, reason });
      setRefundWarning(result.refundRequired);
      setReason("");
      setPhase({ kind: "ready" });
    } catch (error) {
      handleError(error);
      setPhase({ kind: "ready" });
    }
  }

  async function reissue(stale: StaleCharge) {
    setInlineError(null);
    try {
      const created = await createCharge.mutateAsync({
        appointmentId,
        amountCents: stale.amount_cents,
      });
      const charge = toPixCharge(created);
      setQrCharge(charge);
      setPhase({ kind: "qr", chargeId: charge.id });
    } catch (error) {
      handleError(error);
    }
  }

  const qrData: PendingCharge | PixCharge | null =
    phase.kind === "qr"
      ? (qrCharge ?? pendingCharges.find((charge) => charge.id === phase.chargeId) ?? null)
      : null;

  const activePayment =
    phase.kind === "confirm_void"
      ? (settlement?.payments.find((payment) => payment.id === phase.paymentId) ?? null)
      : null;

  // Erro nunca exibe texto de carregamento na descrição (QA-ADR004-06).
  const description = settlementQuery.isError
    ? messages.settlement.errorDescription
    : settlement
      ? formatMessage(messages.settlement.subtitle, {
          cliente: settlement.appointment.customer_name ?? "",
          servico: settlement.appointment.service_name ?? "",
          profissional: settlement.appointment.professional_name ?? "",
        })
      : messages.settlement.loading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="settlement-dialog"
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{messages.settlement.title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {settlementQuery.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <p className="text-sm text-muted-foreground">
              {messages.settlement.loading}
            </p>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : settlementQuery.isError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {messages.settlement.error}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void settlementQuery.refetch()}
              className="h-11 min-h-[44px]"
            >
              {messages.settlement.retry}
            </Button>
          </div>
        ) : settlement ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm lg:grid-cols-5">
              <div>
                <dt className="text-muted-foreground">{messages.settlement.total}</dt>
                <dd className="font-mono tabular-nums">
                  {formatCentsToBRL(settlement.appointment.total_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{messages.settlement.paid}</dt>
                <dd className="font-mono tabular-nums">
                  {formatCentsToBRL(settlement.total_paid_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{messages.settlement.tip}</dt>
                <dd className="font-mono tabular-nums">
                  {formatCentsToBRL(settlement.tip_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {messages.settlement.balance}
                </dt>
                <dd
                  data-testid="settlement-remaining"
                  className="font-mono tabular-nums"
                >
                  {formatCentsToBRL(settlement.remaining_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {messages.settlement.pending}
                </dt>
                <dd
                  data-testid="settlement-reserved"
                  className="font-mono tabular-nums"
                >
                  {formatCentsToBRL(settlement.reserved_cents)}
                </dd>
              </div>
            </dl>

            {refundWarning ? (
              <p role="alert" className="text-sm text-destructive">
                {messages.void.refundWarning}
              </p>
            ) : null}

            {inlineError ? (
              <p role="alert" data-testid="settlement-inline-error" className="text-sm text-destructive">
                {inlineError}
              </p>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">
                {messages.settlement.paymentsTitle}
              </h3>
              {settlement.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {messages.settlement.empty}
                </p>
              ) : (
                <ul className="space-y-2">
                  {settlement.payments.map((payment) => (
                    <SettlementPaymentRow
                      key={payment.id}
                      payment={payment}
                      canVoid={canVoid}
                      onVoidRequest={(target) =>
                        setPhase({ kind: "confirm_void", paymentId: target.id })
                      }
                      messages={messages}
                      timeZone={timeZone}
                    />
                  ))}
                </ul>
              )}
            </section>

            {pendingCharges.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  {messages.settlement.chargesTitle}
                </h3>
                <ul className="space-y-2">
                  {pendingCharges.map((charge) => (
                    <PendingChargeCard
                      key={charge.id}
                      charge={charge}
                      canViewQr={canViewQr}
                      canCancel={canCancel}
                      canReissue={canReissue}
                      expired={isExpired(charge.expires_at)}
                      onShowQr={(target) =>
                        setPhase({ kind: "qr", chargeId: target.id })
                      }
                      onCancel={(target) =>
                        setPhase({
                          kind: "confirm_cancel",
                          chargeId: target.id,
                          force: false,
                        })
                      }
                      onReissue={() =>
                        reissue({
                          id: charge.id,
                          amount_cents: charge.amount_cents,
                          status: "pendente",
                          expires_at: charge.expires_at,
                        })
                      }
                      canConfirmManual={canManual}
                      onConfirmManual={(target) =>
                        setPhase({ kind: "confirm_manual", chargeId: target.id })
                      }
                      messages={messages}
                      timeZone={timeZone}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {staleCharges.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  {messages.settlement.staleTitle}
                </h3>
                <ul className="space-y-2">
                  {staleCharges.map((charge) => (
                    <li
                      key={charge.id}
                      data-testid={`settlement-stale-charge-${charge.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-sm"
                    >
                      <span className="font-mono tabular-nums">
                        {formatCentsToBRL(charge.amount_cents)}
                      </span>
                      <span className="text-muted-foreground">
                        {charge.expires_at
                          ? formatDateInTenantTz(charge.expires_at, timeZone)
                          : messages.settlement.expired}
                      </span>
                      {canReissue ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void reissue(charge)}
                          className="h-11 min-h-[44px]"
                        >
                          {messages.settlement.reissue}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {phase.kind === "qr" && qrData ? (
              <section className="space-y-2 rounded-md border border-border bg-card p-3">
                <h3 className="text-sm font-medium text-foreground">
                  {messages.pix.title}
                </h3>
                <PixQrPanel
                  qrCode={qrData.pix_qr_code}
                  copyPaste={qrData.pix_copy_paste}
                  expiresAt={qrData.expires_at}
                  amountCents={qrData.amount_cents}
                  messages={messages}
                  timeZone={timeZone}
                  onCopyResult={(result) => {
                    if (result === "ok") toast.success(messages.actions.copied);
                    else toast.error(messages.actions.copyFailed);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setQrCharge(null);
                    setPhase({ kind: "ready" });
                  }}
                  className="h-11 min-h-[44px]"
                >
                  {messages.actions.back}
                </Button>
              </section>
            ) : null}

            {phase.kind === "confirm_cancel" ? (
              <InlineConfirmStep
                testId="settlement-confirm-cancel"
                tone="destructive"
                title={messages.settlement.cancelCharge}
                description={messages.settlement.subtitle}
                confirmLabel={messages.actions.confirm}
                cancelLabel={messages.actions.back}
                busy={cancelCharge.isPending}
                onCancel={() => setPhase({ kind: "ready" })}
                onConfirm={() => void confirmCancel(phase.chargeId)}
              />
            ) : null}

            {phase.kind === "confirm_manual" ? (
              <InlineConfirmStep
                testId="settlement-confirm-manual"
                title={messages.settlement.confirmManual}
                description={messages.settlement.subtitle}
                confirmLabel={messages.actions.confirm}
                cancelLabel={messages.actions.back}
                busy={confirmManual.isPending}
                onCancel={() => setPhase({ kind: "ready" })}
                onConfirm={() => void confirmManualBaixa(phase.chargeId)}
              />
            ) : null}

            {phase.kind === "confirm_void" && activePayment ? (
              <InlineConfirmStep
                testId="settlement-confirm-void"
                tone="destructive"
                title={messages.void.title}
                description={messages.void.refundWarning}
                confirmLabel={messages.void.confirm}
                cancelLabel={messages.actions.back}
                busy={voidPayment.isPending}
                onCancel={() => {
                  setReason("");
                  setPhase({ kind: "ready" });
                }}
                onConfirm={() => void confirmVoid(phase.paymentId)}
              >
                <div className="space-y-1">
                  <Label htmlFor="settlement-void-reason">
                    {messages.void.reason}
                  </Label>
                  <textarea
                    id="settlement-void-reason"
                    value={reason}
                    maxLength={500}
                    placeholder={messages.void.reasonPlaceholder}
                    onChange={(event) => setReason(event.target.value)}
                    className="min-h-[80px] w-full rounded-md border border-input bg-background p-2 text-sm"
                  />
                </div>
              </InlineConfirmStep>
            ) : null}

            {voidPayment.isPending || cancelCharge.isPending || confirmManual.isPending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {messages.settlement.loading}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {settlement ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
                className="h-11 min-h-[44px]"
              >
                {messages.actions.close}
              </Button>
              {canRegister && phase.kind === "ready" ? (
                <Button
                  type="button"
                  onClick={() => onRegisterPayment?.()}
                  disabled={busy}
                  className="h-11 min-h-[44px]"
                >
                  {messages.settlement.registerPayment}
                </Button>
              ) : null}
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="h-11 min-h-[44px]">
              {messages.actions.close}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
