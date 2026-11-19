import { useMemo, useState } from "react";
import { Ticket, Gift } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/hooks/usePermissions";
import { useValidateCoupon, useValidateGiftCard } from "@/hooks/useFidelidade";
import { fidelidadeMessages, formatFidelidadeMessage } from "@/app/fidelidade/fidelidade-messages";
import { formatCentsToBRL } from "@/lib/money";

const t = fidelidadeMessages.pdv;

export interface LoyaltyApplied {
  couponCode: string | null;
  discountCents: number;
  giftCode: string | null;
  giftCents: number;
  totalFinalCents: number;
}

/**
 * Painel de fidelidade no PDV (ADR-15 RF-19..RF-21, UX-SPEC D).
 *
 * Pré-criação (sem `appointmentId`) o cupom é só coletado: `coupon_validate`
 * exige o atendimento real (desconto sobre o preço + segmento), então a
 * validação/aplicação autoritativa acontece no fechamento via
 * `apply_coupon_to_closing` (o chamador). Gift card valida na hora
 * (`gift_card_validate` não precisa de atendimento) e resgata no fechamento
 * via `redeem_gift_card`. Nunca só valida no cliente: o desconto que vale é
 * o `discount_cents` do servidor, com trilha em `audit_log`.
 */
export function LoyaltyApplyPanel({
  totalCents,
  hasCustomer,
  entitled,
  appointmentId = null,
  onApplied,
}: {
  totalCents: number;
  hasCustomer: boolean;
  entitled: boolean | null;
  appointmentId?: string | null;
  onApplied: (applied: LoyaltyApplied) => void;
}) {
  const { canRegisterPayments } = usePermissions();
  const validateCoupon = useValidateCoupon();
  const validateGift = useValidateGiftCard();

  const [couponCode, setCouponCode] = useState("");
  const [giftCode, setGiftCode] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number; validated: boolean } | null>(null);
  const [giftBalance, setGiftBalance] = useState<number | null>(null);
  const [giftAppliedCode, setGiftAppliedCode] = useState<string | null>(null);

  const discountCents = coupon?.discountCents ?? 0;
  const giftCents = useMemo(() => {
    if (giftBalance == null) return 0;
    return Math.min(giftBalance, Math.max(0, totalCents - discountCents));
  }, [giftBalance, totalCents, discountCents]);
  const totalFinal = Math.max(0, totalCents - discountCents - giftCents);

  const canApply = entitled === true && canRegisterPayments && hasCustomer;
  const validating = validateCoupon.isPending || validateGift.isPending;

  function emit(next?: Partial<LoyaltyApplied>) {
    onApplied({
      couponCode: coupon?.code ?? null,
      discountCents,
      giftCode: giftAppliedCode,
      giftCents,
      totalFinalCents: totalFinal,
      ...next,
    });
  }

  async function handleValidateCoupon() {
    const code = couponCode.trim().toUpperCase();
    if (!code || !canApply) return;
    if (appointmentId == null) {
      // Sem atendimento real não há validação autoritativa: coleta o código e
      // deixa a validação/aplicação para o fechamento (pós-criação).
      setCoupon({ code, discountCents: 0, validated: false });
      toast.success(t.couponPending);
      emit({ couponCode: code, discountCents: 0, totalFinalCents: Math.max(0, totalCents - giftCents) });
      return;
    }
    try {
      const result = await validateCoupon.mutateAsync({ appointmentId, code });
      if (!result.valid) {
        setCoupon(null);
        toast.error(t.couponInvalid);
        return;
      }
      const discount = result.discount_cents ?? 0;
      setCoupon({ code, discountCents: discount, validated: true });
      toast.success(formatFidelidadeMessage(t.couponApplied, { valor: formatCentsToBRL(discount) }));
      emit({ couponCode: code, discountCents: discount, totalFinalCents: Math.max(0, totalCents - discount - giftCents) });
    } catch {
      setCoupon(null);
      toast.error(t.couponInvalid);
    }
  }

  async function handleValidateGift() {
    const code = giftCode.trim();
    if (!code || !canApply) return;
    try {
      const result = await validateGift.mutateAsync(code.toUpperCase());
      if (!result.valid) {
        setGiftBalance(null);
        setGiftAppliedCode(null);
        toast.error(t.giftInvalid);
        return;
      }
      const balance = result.balance_cents ?? 0;
      setGiftBalance(balance);
      setGiftAppliedCode(code.toUpperCase());
      const applied = Math.min(balance, Math.max(0, totalCents - discountCents));
      toast.success(formatFidelidadeMessage(t.giftRedeemed, { valor: formatCentsToBRL(applied) }));
      emit({ giftCode: code.toUpperCase(), giftCents: applied, totalFinalCents: Math.max(0, totalCents - discountCents - applied) });
    } catch {
      setGiftBalance(null);
      setGiftAppliedCode(null);
      toast.error(t.giftInvalid);
    }
  }

  if (entitled !== true) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasCustomer ? (
          <p className="text-sm text-muted-foreground" role="note">{t.needsAuth}</p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pdv-cupom">{t.couponLabel}</Label>
            <div className="flex gap-2">
              <Input
                id="pdv-cupom"
                placeholder={t.couponPlaceholder}
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                disabled={!canApply || validating}
                className="min-h-[44px]"
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={!canApply || validating || couponCode.trim() === ""}
                onClick={() => void handleValidateCoupon()}
                aria-label={t.applyCoupon}
              >
                <Ticket className="h-4 w-4" aria-hidden="true" />
                {validating ? t.validating : t.validate}
              </Button>
            </div>
            {coupon && !coupon.validated ? (
              <p className="text-sm text-muted-foreground" role="note">
                {t.couponPending}
              </p>
            ) : null}
            {discountCents > 0 ? (
              <p className="text-sm font-medium tabular-nums text-foreground">
                {t.discountLabel}: {formatCentsToBRL(discountCents)}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdv-gift">{t.giftLabel}</Label>
            <div className="flex gap-2">
              <Input
                id="pdv-gift"
                placeholder={t.giftPlaceholder}
                value={giftCode}
                onChange={(e) => setGiftCode(e.target.value)}
                disabled={!canApply || validating}
                className="min-h-[44px]"
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={!canApply || validating || giftCode.trim() === ""}
                onClick={() => void handleValidateGift()}
                aria-label={t.redeemGift}
              >
                <Gift className="h-4 w-4" aria-hidden="true" />
                {validating ? t.validating : t.validate}
              </Button>
            </div>
            {giftCents > 0 ? (
              <p className="text-sm font-medium tabular-nums text-foreground">
                {t.giftLabelShort}: {formatCentsToBRL(giftCents)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">{t.totalFinal}</p>
          <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatCentsToBRL(totalFinal)}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{t.auditHint}</p>
      </CardContent>
    </Card>
  );
}
