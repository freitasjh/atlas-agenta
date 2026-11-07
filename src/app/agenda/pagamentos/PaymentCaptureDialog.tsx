import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMessage } from "@/app/agenda/pagamentos/payments-messages";
import { InlineConfirmStep } from "@/app/agenda/pagamentos/InlineConfirmStep";
import { PaymentLinesEditor } from "@/app/agenda/pagamentos/PaymentLinesEditor";
import { PaymentReceipt } from "@/app/agenda/pagamentos/PaymentReceipt";
import { PaymentTotalsSummary } from "@/app/agenda/pagamentos/PaymentTotalsSummary";
import { PixQrPanel } from "@/app/agenda/pagamentos/PixQrPanel";
import {
  computeChangeCents,
  computeDraftRemainingCents,
  sumLineAmounts,
  sumLineTips,
  validateDraft,
} from "@/app/agenda/pagamentos/payment-math";
import { paymentErrorMessage } from "@/app/agenda/pagamentos/payment-error-message";
import { useAsaasConfig } from "@/hooks/useAsaasConfig";
import {
  useAppointmentSettlement,
  useRegisterAppointmentPayments,
} from "@/hooks/useAppointmentPayments";
import { useCreateCharge } from "@/hooks/useCharges";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PaymentApiError, parsePaymentError } from "@/lib/payment-errors";
import { toast } from "sonner";
import type { AppointmentStatus } from "@/types/domain";
import type {
  AppointmentSettlement,
  PaymentMethod,
  PixCharge,
} from "@/types/payments";
import type { CapturePhase, PaymentLineDraft, ReceiptData } from "./payment-types";
import { paymentsMessages } from "./payments-messages";

export interface PaymentCaptureDialogProps {
  open: boolean;
  mode: "close" | "register";
  appointment: {
    id: string;
    customerName: string;
    serviceName: string;
    professionalName: string;
    totalCents: number;
    status: AppointmentStatus;
  };
  onOpenChange: (open: boolean) => void;
  onCompleted?: (settlement: AppointmentSettlement) => void;
}

const messages = paymentsMessages;

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}-${Math.random()}`;
}

function receiptFromSettlement(
  settlement: AppointmentSettlement,
  draft: PaymentLineDraft[],
): ReceiptData {
  const cashChange = draft.reduce((total, line) => {
    if (line.method !== "dinheiro" || line.cashReceivedCents <= 0) return total;
    return total + computeChangeCents(line.cashReceivedCents, line.amountCents);
  }, 0);
  const changeCents =
    draft.some(
      (line) => line.method === "dinheiro" && line.cashReceivedCents > 0,
    ) && cashChange > 0
      ? cashChange
      : null;

  return {
    customerName: settlement.appointment.customer_name,
    serviceName: settlement.appointment.service_name,
    professionalName: settlement.appointment.professional_name,
    totalCents: settlement.appointment.total_cents,
    paidCents: settlement.total_paid_cents,
    tipCents: settlement.tip_cents,
    changeCents,
    status: settlement.payment_status,
    issuedAt: new Date().toISOString(),
    lines: settlement.payments
      .filter((payment) => payment.voided_at === null)
      .map((payment) => ({
        method: payment.method,
        amountCents: payment.amount_cents,
        tipCents: payment.tip_cents,
      })),
  };
}

/**
 * Shell do fechamento (ADR-004 §2/§9): **um** `Dialog`, sem diálogo filho.
 * Toda confirmação é `InlineConfirmStep` na mesma árvore. Dados/hooks vivem
 * aqui; os componentes de apresentação só recebem props.
 */
export function PaymentCaptureDialog({
  open,
  mode,
  appointment,
  onOpenChange,
  onCompleted,
}: PaymentCaptureDialogProps) {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const [phase, setPhase] = React.useState<CapturePhase>({
    kind: "loading_settlement",
  });
  const [lines, setLines] = React.useState<PaymentLineDraft[]>([]);
  const [idempotencyKey, setIdempotencyKey] = React.useState(newKey);
  const [showValidation, setShowValidation] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [charge, setCharge] = React.useState<PixCharge | null>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  const polling = phase.kind === "awaiting_pix";
  const settlementQuery = useAppointmentSettlement(
    open ? appointment.id : null,
    { enabled: open, poll: polling },
  );
  const register = useRegisterAppointmentPayments();
  const createCharge = useCreateCharge();
  const asaasQuery = useAsaasConfig();

  const settlement = settlementQuery.data ?? null;
  const totalCents = settlement?.appointment.total_cents ?? appointment.totalCents;
  const remainingBase = settlement?.remaining_cents ?? totalCents;

  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: "loading_settlement" });
      setLines([]);
      setShowValidation(false);
      setInlineError(null);
      setCharge(null);
      setIdempotencyKey(newKey());
    }
  }, [open]);

  React.useEffect(() => {
    if (open && settlement && phase.kind === "loading_settlement") {
      setPhase({ kind: "editing" });
    }
  }, [open, settlement, phase.kind]);

  React.useEffect(() => {
    if (open && settlementQuery.isError && phase.kind === "loading_settlement") {
      setPhase({
        kind: "error",
        code: settlementQuery.error?.code ?? "SETTLEMENT_LOAD",
      });
    }
  }, [open, settlementQuery.isError, settlementQuery.error, phase.kind]);

  // Retry do settlement: quando os dados chegam após o erro, volta a editar.
  React.useEffect(() => {
    if (open && settlement && !settlementQuery.isError && phase.kind === "error") {
      setPhase({ kind: "editing" });
    }
  }, [open, settlement, settlementQuery.isError, phase.kind]);

  // Polling do PIX: ao virar `quitado`, o comprovante substitui o QR.
  React.useEffect(() => {
    if (
      open &&
      phase.kind === "awaiting_pix" &&
      settlement?.payment_status === "quitado"
    ) {
      setPhase({
        kind: "success",
        settlement,
        receipt: receiptFromSettlement(settlement, lines),
      });
    }
  }, [open, phase.kind, settlement, lines]);

  React.useEffect(() => {
    if (open && phase.kind === "editing") {
      contentRef.current
        ?.querySelector<HTMLButtonElement>('[data-testid^="payment-method-chip"]')
        ?.focus();
    }
  }, [open, phase.kind]);

  const validation = validateDraft({
    totalCents,
    remainingCents: remainingBase,
    lines,
    mode,
  });
  const draftCents = sumLineAmounts(lines);
  const tipCents = sumLineTips(lines);
  const draftRemaining = computeDraftRemainingCents(remainingBase, lines);
  const hasDraft = lines.length > 0;
  // Rascunho vivo em qualquer fase que ainda pode persisti-lo. Nessas fases
  // ESC/overlay/“fechar” nunca descartam em silêncio: pedem confirmação.
  const hasProtectedDraft =
    hasDraft &&
    (phase.kind === "editing" ||
      phase.kind === "confirm_partial" ||
      phase.kind === "confirm_register_later" ||
      phase.kind === "gateway_error" ||
      phase.kind === "confirm_discard");

  const methodDisabledReasons = React.useMemo(() => {
    if (asaasQuery.isLoading) return {};
    const configured = asaasQuery.data;
    if (!configured || configured.active === false) {
      return { pix_sistema: messages.error.noAsaas } as Partial<
        Record<PaymentMethod, string>
      >;
    }
    return {};
  }, [asaasQuery.isLoading, asaasQuery.data]);

  function addLine(method: PaymentMethod) {
    if (method === "pix_sistema" && lines.some((line) => line.method === method)) {
      return;
    }
    const used = sumLineAmounts(lines);
    setLines((current) => [
      ...current,
      {
        key: newKey(),
        method,
        amountCents: Math.max(remainingBase - used, 0),
        tipCents: 0,
        cashReceivedCents: 0,
        cardConfirmed: false,
      },
    ]);
  }

  function updateLine(next: PaymentLineDraft) {
    setLines((current) =>
      current.map((line) => (line.key === next.key ? next : line)),
    );
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  function toApiPayments(draft: PaymentLineDraft[]) {
    return draft
      .filter((line) => line.amountCents > 0)
      .map((line) => ({
        method: line.method,
        amountCents: line.amountCents,
        tipCents: line.tipCents,
      }));
  }

  async function persist(draft: PaymentLineDraft[], close: boolean, reason: "register" | "register_later" = "register") {
    setInlineError(null);
    setPhase({ kind: "submitting", reason });
    try {
      const response = await register.mutateAsync({
        appointmentId: appointment.id,
        idempotencyKey,
        closeAppointment: close,
        payments: toApiPayments(draft),
      });
      if (response.charge) {
        setCharge(response.charge);
        setPhase({ kind: "awaiting_pix", charge: response.charge });
        return;
      }
      setCharge(null);
      setPhase({
        kind: "success",
        settlement: response.settlement,
        receipt: receiptFromSettlement(response.settlement, draft),
      });
    } catch (error) {
      const api =
        error instanceof PaymentApiError ? error : parsePaymentError(error);
      if (api.code === "IDEMPOTENCY_CONFLICT") {
        setIdempotencyKey(newKey());
        setShowValidation(true);
        setInlineError(paymentErrorMessage(messages, api.code));
        setPhase({ kind: "editing" });
        return;
      }
      if (
        (api.code === "GATEWAY_ERROR" ||
          api.code === "GATEWAY_IN_PROGRESS" ||
          api.code === "GATEWAY_CANCEL_FAILED") &&
        api.settlement
      ) {
        const pixAmount =
          api.pixAmountCents ??
          draft
            .filter((line) => line.method === "pix_sistema")
            .reduce((total, line) => total + line.amountCents, 0);
        setPhase({
          kind: "gateway_error",
          settlement: api.settlement,
          pixAmountCents: pixAmount,
          persisted: api.settlement.payments.length > 0,
        });
        return;
      }
      setInlineError(paymentErrorMessage(messages, api.code));
      setPhase({ kind: "editing" });
    }
  }

  function submit() {
    setShowValidation(true);
    setInlineError(null);
    const result = validateDraft({
      totalCents,
      remainingCents: remainingBase,
      lines,
      mode,
    });
    if (!result.canSubmit) return;
    if (result.requiresPartialConfirm) {
      setPhase({ kind: "confirm_partial", draft: lines });
      return;
    }
    void persist(lines, mode === "close");
  }

  function requestRegisterLater() {
    if (mode !== "close") return;
    setPhase({ kind: "confirm_register_later" });
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (phase.kind === "submitting") return;
    if (hasProtectedDraft) {
      if (phase.kind !== "confirm_discard") {
        setPhase({ kind: "confirm_discard", pendingAction: "leave" });
      }
      return;
    }
    onOpenChange(false);
  }

  async function retrySettlement() {
    const result = await settlementQuery.refetch();
    if (result.data) setPhase({ kind: "editing" });
  }

  async function retryGateway() {
    if (phase.kind !== "gateway_error") return;
    const refreshed = await settlementQuery.refetch();
    const current = refreshed.data ?? phase.settlement;
    if (current.appointment.status === "concluido") {
      setPhase({ kind: "submitting", reason: "register" });
      try {
        const created = await createCharge.mutateAsync({
          appointmentId: appointment.id,
          amountCents: phase.pixAmountCents,
          idempotencyKey,
        });
        setCharge({
          id: created.id,
          amount_cents: created.amount_cents,
          pix_qr_code: created.pix_qr_code,
          pix_copy_paste: created.pix_copy_paste,
          expires_at: created.expires_at,
        });
        setPhase({
          kind: "awaiting_pix",
          charge: {
            id: created.id,
            amount_cents: created.amount_cents,
            pix_qr_code: created.pix_qr_code,
            pix_copy_paste: created.pix_copy_paste,
            expires_at: created.expires_at,
          },
        });
      } catch (error) {
        const api =
          error instanceof PaymentApiError ? error : parsePaymentError(error);
        setPhase({
          kind: "gateway_error",
          settlement: current,
          pixAmountCents: phase.pixAmountCents,
          persisted: current.payments.length > 0,
        });
        setInlineError(paymentErrorMessage(messages, api.code));
      }
      return;
    }
    await persist(lines, mode === "close");
  }

  function finishWithoutPix() {
    if (phase.kind !== "gateway_error") return;
    if (phase.persisted) {
      setPhase({
        kind: "success",
        settlement: phase.settlement,
        receipt: receiptFromSettlement(phase.settlement, lines),
      });
      return;
    }
    if (phase.settlement.appointment.status === "concluido") {
      // A request que devolveu 422 já fechou o atendimento no servidor.
      // Reenviar o lote (`close_appointment: true`) só produziria 409
      // APPOINTMENT_ALREADY_CONCLUDED. A saída correta é invalidar/refetchar
      // e fechar o fluxo — o estado real já é `concluido`.
      void settlementQuery.refetch();
      onOpenChange(false);
      return;
    }
    // Nada persistido e o atendimento segue em aberto: reenvia sem a intenção
    // PIX. Payload muda ⇒ nova chave.
    setIdempotencyKey(newKey());
    void persist(
      lines.filter((line) => line.method !== "pix_sistema"),
      mode === "close",
    );
  }

  function finishSuccess() {
    if (phase.kind !== "success") return;
    onCompleted?.(phase.settlement);
    onOpenChange(false);
  }

  const submitting = phase.kind === "submitting";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        data-testid="payment-capture-dialog"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (submitting) {
            event.preventDefault();
            return;
          }
          if (hasProtectedDraft) {
            event.preventDefault();
            if (phase.kind !== "confirm_discard") {
              setPhase({ kind: "confirm_discard", pendingAction: "leave" });
            }
          }
        }}
        onInteractOutside={(event) => {
          if (submitting) {
            event.preventDefault();
            return;
          }
          if (hasProtectedDraft) {
            event.preventDefault();
            if (phase.kind !== "confirm_discard") {
              setPhase({ kind: "confirm_discard", pendingAction: "leave" });
            }
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLButtonElement>(
              '[data-testid^="payment-method-chip"]',
            )
            ?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{messages.dialog.title}</DialogTitle>
          <DialogDescription>
            {messages.dialog.subtitle}
            <span className="mt-1 block text-xs">
              {formatMessage(messages.dialog.appointmentSummary, {
                cliente: appointment.customerName,
                servico: appointment.serviceName,
                profissional: appointment.professionalName,
              })}
            </span>
          </DialogDescription>
        </DialogHeader>

        {phase.kind === "loading_settlement" ? (
          <div className="space-y-2" aria-busy="true">
            <p className="text-sm text-muted-foreground">{messages.dialog.loading}</p>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {phase.kind === "error" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {paymentErrorMessage(messages, phase.code)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void retrySettlement()}
              className="h-11 min-h-[44px]"
            >
              {messages.actions.retry}
            </Button>
          </div>
        ) : null}

        {phase.kind !== "loading_settlement" &&
        phase.kind !== "error" &&
        phase.kind !== "success" &&
        phase.kind !== "awaiting_pix" ? (
          <>
            <PaymentTotalsSummary
              totalCents={totalCents}
              paidCents={settlement?.total_paid_cents ?? 0}
              draftCents={draftCents}
              remainingCents={draftRemaining}
              tipCents={tipCents}
              messages={messages}
            />

            <PaymentLinesEditor
              lines={lines}
              disabled={
                submitting ||
                phase.kind === "gateway_error" ||
                phase.kind === "confirm_partial"
              }
              onAdd={addLine}
              onUpdate={updateLine}
              onRemove={removeLine}
              messages={messages}
              methodDisabledReasons={methodDisabledReasons}
              showValidation={showValidation}
            />

            {validation.exceeds ? (
              <p role="alert" className="text-sm text-destructive">
                {messages.error.exceeds}
              </p>
            ) : null}

            {inlineError ? (
              <p role="alert" data-testid="payment-inline-error" className="text-sm text-destructive">
                {inlineError}
              </p>
            ) : null}

            {phase.kind === "confirm_partial" ? (
              <InlineConfirmStep
                testId="payment-confirm-partial"
                title={messages.partial.warning}
                description={messages.dialog.subtitle}
                confirmLabel={messages.partial.confirm}
                cancelLabel={messages.actions.back}
                onCancel={() => setPhase({ kind: "editing" })}
                onConfirm={() =>
                  void persist(phase.draft, mode === "close")
                }
              />
            ) : null}

            {phase.kind === "confirm_register_later" ? (
              <InlineConfirmStep
                testId="payment-confirm-register-later"
                title={messages.registerLater.warning}
                description={messages.dialog.subtitle}
                confirmLabel={messages.actions.confirm}
                cancelLabel={messages.actions.back}
                onCancel={() => setPhase({ kind: "editing" })}
                onConfirm={() => void persist([], true, "register_later")}
              />
            ) : null}

            {phase.kind === "confirm_discard" ? (
              <InlineConfirmStep
                testId="payment-confirm-discard"
                tone="destructive"
                title={messages.discard.warning}
                description={messages.dialog.subtitle}
                confirmLabel={messages.discard.confirm}
                cancelLabel={messages.actions.back}
                onCancel={() => setPhase({ kind: "editing" })}
                onConfirm={() => onOpenChange(false)}
              />
            ) : null}

            {phase.kind === "gateway_error" ? (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-destructive">
                  {messages.error.gateway}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void retryGateway()}
                    className="h-11 min-h-[44px]"
                  >
                    {messages.actions.retry}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={finishWithoutPix}
                    className="h-11 min-h-[44px]"
                  >
                    {phase.persisted
                      ? messages.actions.finishWithoutPix
                      : messages.actions.finishWithoutPayment}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {phase.kind === "awaiting_pix" && charge ? (
          <div className="space-y-3">
            <PixQrPanel
              qrCode={charge.pix_qr_code}
              copyPaste={charge.pix_copy_paste}
              expiresAt={charge.expires_at}
              amountCents={charge.amount_cents}
              messages={messages}
              timeZone={timeZone}
              onCopyResult={(result) => {
                if (result === "ok") toast.success(messages.actions.copied);
                else toast.error(messages.actions.copyFailed);
              }}
            />
            <p className="text-sm text-muted-foreground">
              {messages.status.aguardando_pix}
            </p>
          </div>
        ) : null}

        {phase.kind === "success" ? (
          <PaymentReceipt
            data={phase.receipt}
            timeZone={timeZone}
            messages={messages}
          />
        ) : null}

        <DialogFooter>
          {phase.kind === "editing" || phase.kind === "gateway_error" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
                className="h-11 min-h-[44px]"
              >
                {messages.actions.cancel}
              </Button>
              {mode === "close" && phase.kind === "editing" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={requestRegisterLater}
                  disabled={submitting}
                  className="h-11 min-h-[44px]"
                >
                  {messages.actions.registerLater}
                </Button>
              ) : null}
              {phase.kind === "editing" ? (
                <Button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="h-11 min-h-[44px]"
                >
                  {messages.actions.confirm}
                </Button>
              ) : null}
            </>
          ) : null}

          {phase.kind === "submitting" ? (
            <Button type="button" disabled className="h-11 min-h-[44px]">
              <Loader2 className="animate-spin" aria-hidden="true" />
              {messages.actions.confirm}
            </Button>
          ) : null}

          {phase.kind === "awaiting_pix" ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-11 min-h-[44px]">
              {messages.actions.close}
            </Button>
          ) : null}

          {phase.kind === "success" ? (
            <Button type="button" onClick={finishSuccess} className="h-11 min-h-[44px]">
              {messages.actions.close}
            </Button>
          ) : null}

          {phase.kind === "error" ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-11 min-h-[44px]">
              {messages.actions.close}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
