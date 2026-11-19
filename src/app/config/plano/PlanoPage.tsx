import { Link } from "react-router-dom";

import { CheckoutPanel } from "@/app/config/plano/CheckoutPanel";
import { PlanChargesCard } from "@/app/config/plano/PlanChargesCard";
import { PlanCurrentCard } from "@/app/config/plano/PlanCurrentCard";
import { PlanStatusBanner, PlanTrialNote } from "@/app/config/plano/PlanStatusBanner";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { usePlansCatalog } from "@/hooks/usePlansCatalog";
import { planoMessages } from "@/app/config/plano/plano-messages";

const RECURSOS = [
  { chave: "prontuario", rotulo: "Prontuário" },
  { chave: "pacotes", rotulo: "Pacotes de sessões" },
  { chave: "aestheticCheckout", rotulo: "Checkout estética" },
] as const;

/**
 * Plano (`/app/config/plano`, ADR-18 G, RF-35..RF-38): plano atual, uso vs
 * quota, fatura, histórico, upgrade/downgrade e checkout self-service.
 *
 * Estados (RF-36): loading, bloqueado (quitação), cancelado (reativação),
 * pendente (aguardando gateway), sucesso/erro do checkout, guia sem
 * entitlements. Checkout (RF-37) só com `checkoutSelfService` — sem ele,
 * upsell e zero request sensível (RF-38). Sem entitlements, os cards de dados
 * nem montam: leitura de uso/cobrança só com identidade válida.
 */
export function PlanoPage() {
  const { tenant, subscriptionStatus, role } = useCurrentUser();
  const entitlements = usePlanEntitlements();
  const catalogQuery = usePlansCatalog();

  const catalog = catalogQuery.data ?? [];
  const entitled = entitlements !== null;
  const canCheckout = entitlements?.checkoutSelfService === true;
  // Fatura + checkout self-service são admin-only (RF-38): outros papéis veem
  // plano atual/recursos, sem dados de cobrança.
  const isAdmin = role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={planoMessages.page.title}
        descricao={planoMessages.page.description}
      />

      {subscriptionStatus === "trial" && entitled ? <PlanTrialNote /> : null}
      <PlanStatusBanner status={subscriptionStatus} />

      {entitled ? (
        <>
          <PlanCurrentCard
            planSlug={tenant?.plan ?? null}
            subscriptionStatus={subscriptionStatus}
            catalog={catalog}
            catalogLoading={catalogQuery.isLoading}
            catalogError={catalogQuery.isError}
            onRetryCatalog={() => void catalogQuery.refetch()}
            enabled
          />
          {isAdmin ? (
            <>
              <PlanChargesCard />
              <CheckoutPanel
                entitled={canCheckout}
                currentSlug={tenant?.plan ?? null}
                catalog={catalog}
              />
            </>
          ) : null}
        </>
      ) : (
        <StatePanel
          titulo="Informações de uso indisponíveis"
          descricao="Ainda não conseguimos ler os recursos do seu plano. A agenda continua funcionando normalmente."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{planoMessages.resources.title}</CardTitle>
          <CardDescription>
            {planoMessages.resources.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entitled ? (
            <>
              <ul className="divide-y divide-border">
                {RECURSOS.map((recurso) => {
                  const liberado = entitlements[recurso.chave];
                  return (
                    <li
                      key={recurso.chave}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <span className="text-sm font-medium text-foreground">
                        {recurso.rotulo}
                      </span>
                      <span
                        className={
                          liberado
                            ? "text-sm font-semibold text-foreground"
                            : "text-sm text-muted-foreground"
                        }
                      >
                        {liberado ? "Liberado" : "Bloqueado"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {!entitlements.prontuario ||
              !entitlements.pacotes ||
              !entitlements.aestheticCheckout ? (
                <div className="mt-4">
                  <Button asChild variant="outline">
                    <Link to="/precos">Ver planos</Link>
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Os recursos liberados aparecem aqui assim que o plano for lido.
            </p>
          )}
        </CardContent>
      </Card>

      {catalogQuery.isLoading ? (
        <div aria-busy="true" aria-label={planoMessages.page.loading}>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : catalogQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar os planos"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button variant="outline" onClick={() => void catalogQuery.refetch()}>
            {planoMessages.page.retry}
          </Button>
        </StatePanel>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/precos">Ver todos os planos</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
