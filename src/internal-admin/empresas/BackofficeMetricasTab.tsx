import { useState } from "react";

import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import {
  isValidPeriod,
  useBackofficeMembershipMrrChurn,
  useBackofficeNfceVolume,
  useBackofficeSaasMrr,
} from "@/internal-admin/backoffice/useBackoffice";
import { useBackofficeEntitlements } from "@/internal-admin/backoffice/useBackofficeEntitlements";
import { formatCentsToBRL } from "@/lib/money";

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function trintaDiasAtrasIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function formatarPercentual(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

interface KpiCardProps {
  titulo: string;
  valor: string;
  detalhe?: string;
  aviso?: string;
  ariaLabel?: string;
}

function KpiCard({ titulo, valor, detalhe, aviso, ariaLabel }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p
          className="font-display text-3xl font-semibold tabular-nums"
          aria-label={ariaLabel}
        >
          {valor}
        </p>
        {detalhe ? (
          <p className="text-xs text-muted-foreground">{detalhe}</p>
        ) : null}
        {aviso ? <p className="text-xs text-destructive">{aviso}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Aba **Métricas** do back-office (`/internal-admin/empresas`, ADR-11 / T1.5).
 *
 * Três leituras independentes por RPC super-admin-only:
 * - MRR SaaS (`mrr_report`, `kind=saas`): tenants ativos × preço do catálogo —
 *   snapshot **atual** (sem seletor de mês; não há série histórica).
 * - MRR/churn membership (`membership_mrr_churn`): recorrência dos clientes
 *   finais, normalizada mensal, + canceladas no período.
 * - Volume NFCe (`nfce_volume`): autorizadas/contingência/rejeitadas.
 *
 * Decisão PRD §10.14: **SaaS ≠ membership** — cada card tem sua própria fonte e a
 * UI nunca soma os dois (o card de membership repete o aviso).
 *
 * Gating `backofficeT15`: `false`/`null` → painel legível bloqueado ("não
 * incluído") e zero request; falha de rede no catálogo → painel "não foi
 * possível verificar" com retry, também sem request.
 */
export function BackofficeMetricasTab() {
  const gating = useBackofficeEntitlements();
  const liberado =
    gating.status === "ready" && gating.entitlements?.backofficeT15 === true;

  const [from, setFrom] = useState<string>(() => trintaDiasAtrasIso());
  const [to, setTo] = useState<string>(() => hojeIso());

  const periodoValido = isValidPeriod(from, to);

  const saasQuery = useBackofficeSaasMrr(liberado && periodoValido);
  const membershipQuery = useBackofficeMembershipMrrChurn(
    liberado && periodoValido,
    from,
    to,
  );
  const nfceQuery = useBackofficeNfceVolume(liberado && periodoValido, from, to);

  if (gating.status === "loading") {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (gating.status === "error") {
    return (
      <StatePanel
        titulo="Não foi possível verificar o acesso ao back-office"
        descricao="Falha ao consultar o catálogo de planos (rede ou servidor). Nenhuma métrica foi consultada; o acesso não pode ser confirmado."
      >
        <Button variant="outline" onClick={gating.retry}>
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  if (!liberado) {
    return (
      <StatePanel
        titulo="Métricas do back-office: recurso não incluído no plano atual"
        descricao="MRR, churn e volume de NFCe do back-office não estão liberados para esta instalação. Nenhum dado foi consultado."
      />
    );
  }

  const carregando =
    saasQuery.isLoading || membershipQuery.isLoading || nfceQuery.isLoading;
  const erro =
    saasQuery.isError || membershipQuery.isError || nfceQuery.isError;

  const saas = saasQuery.data ?? null;
  const membership = membershipQuery.data ?? null;
  const nfce = nfceQuery.data ?? null;

  const mixPlanos = saas
    ? Object.entries(saas.by_plan)
        .sort((a, b) => b[1].mrr_cents - a[1].mrr_cents)
        .slice(0, 3)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-44">
          <Label htmlFor="backoffice-from">Início</Label>
          <Input
            id="backoffice-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <Label htmlFor="backoffice-to">Fim</Label>
          <Input
            id="backoffice-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void saasQuery.refetch();
            void membershipQuery.refetch();
            void nfceQuery.refetch();
          }}
        >
          Atualizar
        </Button>
      </div>

      <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        MRR SaaS (planos da plataforma) e MRR membership (recorrência dos clientes
        finais) são métricas <strong>separadas</strong> e nunca são somadas.
      </p>

      {!periodoValido ? (
        <StatePanel
          titulo="Período inválido"
          descricao="A data inicial deve ser anterior ou igual à data final."
        />
      ) : carregando ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : erro ? (
        <StatePanel
          titulo="Não foi possível carregar as métricas do back-office"
          descricao="Verifique a conexão e tente novamente."
        >
          <div role="alert" className="sr-only">
            Erro ao carregar métricas de MRR, churn ou NFCe.
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void saasQuery.refetch();
              void membershipQuery.refetch();
              void nfceQuery.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              titulo="MRR SaaS"
              valor={
                saas && saas.base_ativa > 0
                  ? formatCentsToBRL(saas.mrr_cents)
                  : "—"
              }
              detalhe={
                saas
                  ? `${saas.base_ativa} empresa(s) ativa(s) · MRR atual`
                  : undefined
              }
              ariaLabel={
                saas && saas.base_ativa === 0 ? "MRR SaaS sem pagantes" : undefined
              }
            />
            <KpiCard
              titulo="MRR membership"
              valor={
                membership && membership.ativas > 0
                  ? formatCentsToBRL(membership.mrr_cents)
                  : "—"
              }
              detalhe={
                membership
                  ? `${membership.ativas} ativa(s) · ${membership.inadimplentes} inadimplente(s)`
                  : undefined
              }
            />
            <KpiCard
              titulo="Churn membership"
              valor={formatarPercentual(membership?.churn_pct ?? null)}
              detalhe={
                membership
                  ? `${membership.canceladas_periodo} cancelada(s) / ${membership.base_inicio} na base`
                  : undefined
              }
            />
            <KpiCard
              titulo="NFCe autorizadas"
              valor={nfce ? String(nfce.autorizadas) : "—"}
              detalhe={
                nfce
                  ? `${nfce.contingencia} contingência · ${nfce.rejeitadas} rejeitada(s)`
                  : undefined
              }
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>MRR SaaS por plano</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {mixPlanos.length === 0 ? (
                  <p className="text-muted-foreground">Sem empresas pagantes no momento.</p>
                ) : (
                  mixPlanos.map(([plano, entry]) => (
                    <p key={plano} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        {plano} · {entry.base} empresa(s)
                      </span>
                      <span className="tabular-nums">
                        {formatCentsToBRL(entry.mrr_cents)}
                      </span>
                    </p>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Membership — detalhe</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="flex justify-between gap-3">
                  <span className="text-muted-foreground">MRR em risco</span>
                  <span className="tabular-nums">
                    {membership
                      ? formatCentsToBRL(membership.mrr_em_risco_cents)
                      : "—"}
                  </span>
                </p>
                <p className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Pausadas</span>
                  <span className="tabular-nums">
                    {membership?.pausadas ?? "—"}
                  </span>
                </p>
                <p className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    Volume NFCe autorizado
                  </span>
                  <span className="tabular-nums">
                    {nfce ? formatCentsToBRL(nfce.valor_autorizado_cents) : "—"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  MRR membership nunca é somado ao MRR SaaS.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
