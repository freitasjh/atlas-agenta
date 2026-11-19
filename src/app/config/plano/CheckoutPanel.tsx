import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EntitlementGate } from "@/components/EntitlementGate";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PixQrPanel } from "@/app/agenda/pagamentos/PixQrPanel";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { useCreateSelfCheckout } from "@/hooks/useSelfCheckout";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatCentsToBRL } from "@/lib/money";
import { formatDateInTenantTz } from "@/lib/datetime";
import { formatPlanPrice, type Plan } from "@/lib/plans";
import { planoMessages } from "@/app/config/plano/plano-messages";

const t = planoMessages.checkout;

interface CheckoutPanelProps {
  /** Entitlement `checkoutSelfService`: sem ele, opções legíveis + upsell. */
  entitled: boolean;
  currentSlug: string | null;
  catalog: Plan[];
}

function fillTemplate(template: string, value: string): string {
  return template.replace("{plano}", value).replace("{data}", value);
}

/**
 * Troca de plano com checkout self-service (RF-37/RF-38): opções de
 * upgrade/downgrade do catálogo, confirmação explícita (timing distinto),
 * geração de PIX via `create-checkout`, polling do tenant enquanto aguarda
 * pagamento e estados sucesso/erro. Sem entitlement, nada é disparado.
 */
export function CheckoutPanel({
  entitled,
  currentSlug,
  catalog,
}: CheckoutPanelProps) {
  const { tenant, subscriptionStatus } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const queryClient = useQueryClient();
  const checkout = useCreateSelfCheckout();

  const [selected, setSelected] = useState<Plan | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const options = catalog.filter((p) => p.slug !== currentSlug);
  const result = checkout.data ?? null;
  const failed = checkout.isError;

  // Polling do tenant enquanto o PIX aguarda pagamento: o webhook atualiza
  // `subscription_status`/plano; a releitura reflete sem reload. Para quando a
  // assinatura sai de `pendente` (pagamento confirmado ou expiração) ou no teto
  // de ~5min (75 × 4s); sempre limpo ao sair.
  useEffect(() => {
    if (!confirmed || !result || result.kind !== "upgrade") return;
    if (
      subscriptionStatus !== undefined &&
      subscriptionStatus !== null &&
      subscriptionStatus !== "pendente"
    )
      return;
    let runs = 0;
    const id = window.setInterval(() => {
      runs += 1;
      void queryClient.invalidateQueries({ queryKey: ["tenant"] });
      if (runs >= 75) window.clearInterval(id);
    }, 4000);
    return () => window.clearInterval(id);
  }, [confirmed, result, queryClient, subscriptionStatus]);

  function handleConfirm() {
    if (!selected) return;
    setConfirmed(false);
    checkout.mutate(
      { plan: selected.slug },
      {
        onSuccess: () => setConfirmed(true),
        onError: () => {
          setConfirmed(false);
          toast.error(t.errorTitle);
        },
      },
    );
  }

  function handleRetry() {
    checkout.reset();
    setConfirmed(false);
  }

  function checkStatus() {
    void queryClient.invalidateQueries({ queryKey: ["tenant"] });
    toast.success(t.pendingTitle);
  }

  const isDowngrade = confirmed && result?.kind === "downgrade";

  return (
    <Card id="trocar-plano" aria-label={t.title}>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <EntitlementGate
          entitled={entitled}
          recurso="Checkout self-service"
          acaoLabel={t.choosePlan}
        >
          {failed && !checkout.isPending ? (
            <StatePanel titulo={t.errorTitle} descricao={t.errorDescription}>
              <Button variant="outline" onClick={handleRetry}>
                {t.retryCheckout}
              </Button>
            </StatePanel>
          ) : confirmed && result ? (
            <div className="space-y-4">
              <StatePanel
                titulo={isDowngrade ? t.downgradeTitle : t.pendingTitle}
                descricao={
                  isDowngrade
                    ? `${t.downgradeDescription}${
                        result.effective_at
                          ? ` ${fillTemplate(
                              t.downgradeScheduled,
                              formatDateInTenantTz(
                                result.effective_at,
                                timeZone,
                              ),
                            )}`
                          : ""
                      }`
                    : t.pendingDescription
                }
              >
                {isDowngrade ? null : (
                  <Button variant="outline" onClick={checkStatus}>
                    {planoMessages.status.pendenteAction}
                  </Button>
                )}
              </StatePanel>
              {result.kind === "upgrade" &&
              (result.pix_qr_code || result.pix_copy_paste) ? (
                <PixQrPanel
                  qrCode={result.pix_qr_code ?? null}
                  copyPaste={result.pix_copy_paste ?? null}
                  expiresAt={result.expires_at ?? null}
                  amountCents={
                    selected?.price_cents ??
                    catalog.find((p) => p.slug === currentSlug)?.price_cents ??
                    0
                  }
                  status="pendente"
                  messages={paymentsMessages}
                  timeZone={timeZone}
                  onCopyResult={(copyResult) => {
                    if (copyResult === "ok")
                      toast.success(paymentsMessages.actions.copied);
                    else toast.error(paymentsMessages.actions.copyFailed);
                  }}
                />
              ) : null}
              <Button variant="outline" onClick={handleRetry}>
                {t.retryCheckout}
              </Button>
            </div>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noOptions}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {options.map((option) => (
                <li
                  key={option.slug}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium text-foreground">
                      {option.nome}
                    </p>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {option.price_cents === 0
                        ? planoMessages.current.free
                        : `${formatPlanPrice(option)}${planoMessages.current.perMonth}`}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {option.publico}
                  </p>
                  <Button
                    variant="outline"
                    disabled={checkout.isPending}
                    onClick={() => setSelected(option)}
                  >
                    {checkout.isPending ? (
                      <>
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        {t.starting}
                      </>
                    ) : (
                      t.choosePlan
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Dialog
            open={selected !== null && !confirmed && !failed}
            onOpenChange={(next) => {
              if (!next) setSelected(null);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t.confirmTitle}</DialogTitle>
                <DialogDescription>
                  {selected
                    ? selected.price_cents >=
                      (catalog.find((p) => p.slug === currentSlug)
                        ?.price_cents ?? 0)
                      ? fillTemplate(t.confirmUpgrade, selected.nome)
                      : fillTemplate(t.confirmDowngrade, selected.nome)
                    : null}
                </DialogDescription>
              </DialogHeader>
              {selected ? (
                <p className="text-sm tabular-nums text-muted-foreground">
                  {formatCentsToBRL(selected.price_cents)}
                  {planoMessages.current.perMonth}
                </p>
              ) : null}
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelected(null)}
                >
                  {t.cancelAction}
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={checkout.isPending}
                >
                  {checkout.isPending ? (
                    <>
                      <Loader2
                        className="mr-2 h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      {t.starting}
                    </>
                  ) : (
                    t.confirmAction
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </EntitlementGate>
      </CardContent>
    </Card>
  );
}
