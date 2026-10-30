import { Link } from "react-router-dom";
import { CalendarCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatPlanPrice, type Plan } from "@/lib/plans";

/**
 * Card de plano compartilhado (ADR-03). Fonte única de markup do card: a
 * `/precos` (ADR-06) e a prévia de planos da landing (ADR-05) consomem o mesmo
 * componente, garantindo por construção que valor e descrição não divirjam.
 *
 * Componente **apresentacional e sem estado**, local de marketing (não é
 * primitivo de `src/components/ui`). Consome um `Plan` inteiro de `PLANS` e
 * formata o preço com `formatPlanPrice` (ADR-01) — nunca cola `59`/`149`/`259`
 * nem deriva preço fora de `plans.ts` (CA07). A CTA constrói o `href` a partir
 * do `plan.slug` tipado (RF16/CA08); nenhum valor cru de `?plano` é lido aqui.
 *
 * Contraste (analysis-frontend §3): o número do preço usa `foreground` (não
 * `primary`), eliminando o risco do jade limítrofe no tema claro. O jade fica
 * só na borda/selo do card recomendado.
 */

interface PlanCardProps {
  plan: Plan;
  variant: "full" | "preview";
}

/** Selo "Recomendado" — exibido apenas quando `plan.recomendado` (RF06/CA04). */
function RecommendedBadge() {
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
      Recomendado
    </span>
  );
}

/** Preço mensal em BRL: número em peso display sobre `foreground`, "/mês" ao lado. */
function PlanPrice({ plan }: { plan: Plan }) {
  return (
    <p className="flex items-baseline gap-1">
      <span className="font-display text-4xl font-semibold tracking-tight">
        {formatPlanPrice(plan)}
      </span>
      <span className="text-sm text-muted-foreground">/mês</span>
    </p>
  );
}

export function PlanCard({ plan, variant }: PlanCardProps) {
  const borderClass = plan.recomendado ? "border-primary" : "border-border";

  if (variant === "preview") {
    return (
      <div
        className={`flex flex-col gap-3 rounded-lg border bg-card p-5 ${borderClass}`}
      >
        {plan.recomendado ? <RecommendedBadge /> : null}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {plan.publico}
          </p>
          <h3 className="font-display text-lg font-semibold">{plan.nome}</h3>
        </div>
        <PlanPrice plan={plan} />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-4 rounded-lg border bg-card p-6 ${borderClass}`}
    >
      <div className="flex flex-col gap-2">
        {plan.recomendado ? <RecommendedBadge /> : null}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {plan.publico}
          </p>
          <h2 className="font-display text-xl font-semibold">{plan.nome}</h2>
        </div>
      </div>

      <PlanPrice plan={plan} />

      <ul className="space-y-2 text-sm text-muted-foreground">
        {plan.destaques.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <CalendarCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        className="mt-auto w-full"
        variant={plan.recomendado ? "default" : "outline"}
      >
        <Link to={`/cadastro?plano=${plan.slug}`}>
          Começar com o {plan.nome}
        </Link>
      </Button>
    </div>
  );
}
