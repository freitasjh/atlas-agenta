import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useProfessionals } from "@/hooks/useProfessionals";
import {
  formatPlanPrice,
  getPlan,
  parsePlanSlug,
  type Plan,
} from "@/lib/plans";
import type { SubscriptionStatus } from "@/types/domain";
import { planoMessages } from "@/app/config/plano/plano-messages";

const t = planoMessages.current;

interface PlanCurrentCardProps {
  planSlug: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  catalog: Plan[];
  catalogLoading: boolean;
  catalogError: boolean;
  onRetryCatalog: () => void;
  /** `false` (entitlements null) = não dispara leitura de uso. */
  enabled: boolean;
}

function QuotaLine({
  rotulo,
  uso,
  limite,
}: {
  rotulo: string;
  uso: string;
  limite: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">
        {uso} <span className="text-muted-foreground">de {limite}</span>
      </span>
    </li>
  );
}

/**
 * Plano atual + uso vs quota (RF-35): nome/preço do plano vigente, status e
 * limites do catálogo SSoT. Profissionais em uso é contagem real; a contagem
 * mensal de agendamentos chega com o backend de métricas — até lá, exibe "—"
 * com nota honesta em vez de número inventado.
 */
export function PlanCurrentCard({
  planSlug,
  subscriptionStatus,
  catalog,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  enabled,
}: PlanCurrentCardProps) {
  const slug = planSlug ? parsePlanSlug(planSlug) : null;
  const { limits } = usePlanLimits(slug, { enabled });
  const professionalsQuery = useProfessionals({
    enabled,
    select: (list) => list.filter((p) => p.active).length,
  });

  if (catalogLoading) {
    return (
      <div aria-busy="true" aria-label={planoMessages.page.loading}>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (catalogError) {
    return (
      <StatePanel
        titulo="Não foi possível carregar o plano"
        descricao="Verifique sua conexão e tente novamente."
      >
        <Button variant="outline" onClick={onRetryCatalog}>
          {planoMessages.page.retry}
        </Button>
      </StatePanel>
    );
  }

  if (!slug) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <StatePanel titulo={t.noPlan} descricao={t.noPlanDescription} />
        </CardContent>
      </Card>
    );
  }

  const plan = catalog.find((p) => p.slug === slug) ?? getPlan(slug);
  const professionalsUsed = professionalsQuery.data ?? null;

  return (
    <Card aria-label={`${t.title}: ${plan.nome}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{plan.nome}</CardTitle>
            <CardDescription>{plan.publico}</CardDescription>
          </div>
          {subscriptionStatus ? (
            <Badge variant="secondary">{subscriptionStatus}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold tracking-tight tabular-nums text-foreground">
          {plan.price_cents === 0 ? (
            t.free
          ) : (
            <>
              {formatPlanPrice(plan)}
              <span className="text-base font-normal text-muted-foreground">
                {t.perMonth}
              </span>
            </>
          )}
        </p>
        <ul className="mt-2 divide-y divide-border">
          <QuotaLine
            rotulo={t.professionalsUsed}
            uso={professionalsUsed === null ? t.notMeasured : String(professionalsUsed)}
            limite={
              limits?.profLimit == null ? t.unlimited : String(limits.profLimit)
            }
          />
          <QuotaLine
            rotulo={t.appointmentsQuota}
            uso={t.notMeasured}
            limite={
              limits?.apptLimit == null ? t.unlimited : String(limits.apptLimit)
            }
          />
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          {t.usagePendingHint}
        </p>
      </CardContent>
    </Card>
  );
}
