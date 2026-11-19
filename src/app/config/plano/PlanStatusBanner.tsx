import { Link } from "react-router-dom";

import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import type { SubscriptionStatus } from "@/types/domain";
import { planoMessages } from "@/app/config/plano/plano-messages";

const t = planoMessages.status;

interface PlanStatusBannerProps {
  status: SubscriptionStatus | null;
  onCheckStatus?: () => void;
  checking?: boolean;
}

/**
 * Faixa de estado da assinatura (RF-36): `bloqueado` (quitação + CTA para a
 * fatura), `cancelado` (reativação via checkout), `pendente` (aguardando
 * gateway + verificação manual). `trial`/`ativo`/null não rendem faixa.
 */
export function PlanStatusBanner({
  status,
  onCheckStatus,
  checking = false,
}: PlanStatusBannerProps) {
  if (status === "bloqueado") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
      >
        <h2 className="font-display text-base font-semibold tracking-tight text-foreground">
          {t.bloqueadoTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.bloqueadoDescription}
        </p>
        <div className="mt-3">
          <Button asChild size="sm">
            <a href="#fatura-atual">{t.bloqueadoAction}</a>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "cancelado") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
      >
        <h2 className="font-display text-base font-semibold tracking-tight text-foreground">
          {t.canceladoTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.canceladoDescription}
        </p>
        <div className="mt-3">
          <Button asChild size="sm">
            <a href="#trocar-plano">{t.canceladoAction}</a>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "pendente") {
    return (
      <div
        role="status"
        className="rounded-lg border border-status-pendente/40 bg-status-pendente/5 p-4"
      >
        <h2 className="font-display text-base font-semibold tracking-tight text-foreground">
          {t.pendenteTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.pendenteDescription}
        </p>
        {onCheckStatus ? (
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={onCheckStatus}
              disabled={checking}
            >
              {t.pendenteAction}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

/** Faixa informativa de trial com upsell para os planos. */
export function PlanTrialNote() {
  return (
    <StatePanel titulo={t.trialTitle} descricao={t.trialDescription}>
      <Button asChild variant="outline">
        <Link to="/precos">Ver planos</Link>
      </Button>
    </StatePanel>
  );
}
