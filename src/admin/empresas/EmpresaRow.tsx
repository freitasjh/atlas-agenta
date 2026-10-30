import * as React from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { TableCell, TableRow } from "@/components/ui/table";
import { getPlanLabel } from "@/lib/subscription-status";
import type { TenantListItem } from "@/types/domain";

/**
 * Formata `trial_ends_at` (instante UTC) como data de calendário no fuso da
 * própria empresa (`row.timezone`, default `America/Sao_Paulo`) — não no fuso do
 * browser do super admin. `null` vira "—" (nunca "null"/vazio). Reforço de
 * varredura: quando a empresa está em `trial` e a data já passou, a chamada
 * sinaliza "vencido" para a UI realçar.
 */
function formatTrialEnd(
  trialEndsAt: string | null,
  timezone: string,
): { text: string; expired: boolean } {
  if (trialEndsAt === null) {
    return { text: "—", expired: false };
  }
  const date = new Date(trialEndsAt);
  const text = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeZone: timezone || "America/Sao_Paulo",
  }).format(date);
  return { text, expired: date.getTime() < Date.now() };
}

/** Nome exibido: fantasia quando houver, senão razão social. */
function displayName(tenant: TenantListItem): string {
  const trade = tenant.trade_name?.trim();
  return trade && trade.length > 0 ? trade : tenant.legal_name;
}

interface EmpresaRowProps {
  tenant: TenantListItem;
  /**
   * Slot da ação por empresa (ex.: botão "Mudar status" — ADR-07). Recebe a
   * empresa da linha; a ADR-06 não passa nada (a lista ainda não opera status).
   */
  renderAction?: (tenant: TenantListItem) => React.ReactNode;
}

/** Nome do campo "fim do trial" em pt-BR, com reforço visual de trial vencido. */
function TrialEndValue({
  tenant,
}: {
  tenant: TenantListItem;
}) {
  const trial = formatTrialEnd(tenant.trial_ends_at, tenant.timezone);
  const highlightExpired =
    trial.expired && tenant.subscription_status === "trial";
  return (
    <span
      className={
        highlightExpired ? "font-medium text-destructive" : undefined
      }
      aria-label={highlightExpired ? "Trial vencido" : undefined}
    >
      {trial.text}
    </span>
  );
}

/**
 * Linha da tabela (desktop, ≥md) de uma empresa na lista do painel admin.
 * Colunas: Empresa (fantasia→razão social + documento discreto), Plano (rótulo
 * pt-BR), Status (badge de assinatura) e Fim do trial (data no fuso da empresa).
 * A coluna de ação só renderiza quando `renderAction` é passado (ADR-07).
 */
export function EmpresaRow({ tenant, renderAction }: EmpresaRowProps) {
  return (
    <TableRow>
      <TableCell>
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{displayName(tenant)}</p>
          {tenant.document ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {tenant.document}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell>{getPlanLabel(tenant.plan)}</TableCell>
      <TableCell>
        <StatusBadge subscriptionStatus={tenant.subscription_status} />
      </TableCell>
      <TableCell className="tabular-nums">
        <TrialEndValue tenant={tenant} />
      </TableCell>
      {renderAction ? (
        <TableCell className="text-right">{renderAction(tenant)}</TableCell>
      ) : null}
    </TableRow>
  );
}

/**
 * Card (mobile, <md) de uma empresa: o mesmo conteúdo da linha em pares
 * rótulo/valor (`<dl>`), com a ação full-width no rodapé quando houver. Valor
 * nunca fica sem rótulo associado (a11y).
 */
export function EmpresaCard({ tenant, renderAction }: EmpresaRowProps) {
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{displayName(tenant)}</p>
          {tenant.document ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {tenant.document}
            </p>
          ) : null}
        </div>
        <StatusBadge subscriptionStatus={tenant.subscription_status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="space-y-0.5">
          <dt className="text-xs text-muted-foreground">Plano</dt>
          <dd className="text-foreground">{getPlanLabel(tenant.plan)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-xs text-muted-foreground">Fim do trial</dt>
          <dd className="text-foreground tabular-nums">
            <TrialEndValue tenant={tenant} />
          </dd>
        </div>
      </dl>
      {renderAction ? (
        <div className="mt-3 [&>*]:w-full">{renderAction(tenant)}</div>
      ) : null}
    </li>
  );
}
