"use client"

import * as React from "react"
import { Check, X, Sparkles, HelpCircle, ShieldCheck } from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import { Switch } from "@/components/shadcn/ui/switch"
import { cn } from "@/lib/cn"
import {
  type BillingPeriod,
  PRICING_PLANS,
  COMPARISON_TABLE,
  type PricingPlan,
} from "./pricing-types"

interface PricingTableProps {
  className?: string
  onSelectPlan?: (planId: string, billing: BillingPeriod) => void
  showComparison?: boolean
}

export function PricingTable({
  className,
  onSelectPlan,
  showComparison = true,
}: PricingTableProps) {
  const [billing, setBilling] = React.useState<BillingPeriod>("annually")
  const [isComparisonOpen, setIsComparisonOpen] = React.useState(false)

  const isAnnual = billing === "annually"

  return (
    <section className={cn("relative mx-auto w-full max-w-7xl py-12 px-4 sm:px-6 lg:px-8", className)}>
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col items-center text-center max-w-3xl mx-auto mb-10">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs font-semibold text-foreground tracking-wide mb-3 shadow-2xs">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Planos Transparentes e Escaláveis</span>
        </div>

        <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          Preços simples. Recursos sem limites.
        </h2>

        <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed max-w-2xl">
          Escolha o plano ideal para modernizar sua gestão, agendamento de consultas e fluxo operacional. Teste 14 dias grátis sem cartão.
        </p>

        {/* Toggle de Faturamento (Mensal vs Anual) */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <span
            className={cn(
              "text-xs font-semibold transition-colors cursor-pointer",
              !isAnnual ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setBilling("monthly")}
          >
            Faturamento Mensal
          </span>

          <Switch
            checked={isAnnual}
            onCheckedChange={(checked) => setBilling(checked ? "annually" : "monthly")}
            aria-label="Alternar entre cobrança mensal e anual"
          />

          <span
            className={cn(
              "flex items-center gap-2 text-xs font-semibold transition-colors cursor-pointer",
              isAnnual ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setBilling("annually")}
          >
            <span>Faturamento Anual</span>
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
              Economize 20%
            </span>
          </span>
        </div>
      </div>

      {/* Cards de Preço */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8 items-stretch">
        {PRICING_PLANS.map((plan: PricingPlan) => {
          const price = isAnnual ? plan.priceAnnually : plan.priceMonthly

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col justify-between rounded-2xl border bg-card p-6 sm:p-8 transition-all duration-200",
                plan.isPopular
                  ? "border-primary shadow-[0_8px_32px_rgba(0,0,0,0.08)] ring-2 ring-primary/20 z-10 scale-[1.02] lg:-translate-y-2"
                  : "border-border/80 shadow-xs hover:border-foreground/30 hover:shadow-md"
              )}
            >
              {/* Rim light superior */}
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl",
                  plan.isPopular
                    ? "bg-gradient-to-r from-transparent via-primary to-transparent"
                    : "bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
                )}
              />

              {/* Badge de Destaque */}
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-bold tracking-wide uppercase text-primary-foreground shadow-sm">
                    <Sparkles className="h-3 w-3" />
                    {plan.badge}
                  </span>
                </div>
              )}

              <div>
                {/* Nome do Plano e Descrição */}
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold tracking-tight text-foreground">
                    {plan.name}
                  </h3>
                  {plan.limitLabel && (
                    <span className="rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {plan.limitLabel}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-muted-foreground leading-relaxed min-h-[36px]">
                  {plan.description}
                </p>

                {/* Preço */}
                <div className="mt-6 flex items-baseline gap-1 border-y border-border/50 py-4">
                  <span className="text-xs font-semibold text-muted-foreground">R$</span>
                  <span className="font-mono text-4xl font-extrabold tracking-tight text-foreground tabular-nums">
                    {price}
                  </span>
                  <span className="text-xs text-muted-foreground font-medium">
                    /mês {isAnnual && <span className="text-[10px] block text-emerald-600 dark:text-emerald-400 font-semibold">cobrado anualmente</span>}
                  </span>
                </div>

                {/* Lista de Features */}
                <div className="mt-6 space-y-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    O que está incluso:
                  </p>

                  <ul className="space-y-2 text-xs">
                    {plan.features.map((feature, idx) => (
                      <li
                        key={idx}
                        className={cn(
                          "flex items-start gap-2.5",
                          feature.included
                            ? "text-foreground"
                            : "text-muted-foreground/60"
                        )}
                      >
                        {feature.included ? (
                          <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mt-0.5">
                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/50 mt-0.5">
                            <X className="h-2.5 w-2.5" />
                          </div>
                        )}
                        <span className={cn(feature.highlight && "font-semibold text-foreground")}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Botão de Ação */}
              <div className="mt-8 pt-4 border-t border-border/40">
                <Button
                  type="button"
                  variant={plan.isPopular ? "default" : "outline"}
                  onClick={() => onSelectPlan?.(plan.id, billing)}
                  className={cn(
                    "w-full h-10 text-xs font-semibold shadow-xs",
                    plan.isPopular && "shadow-md hover:shadow-lg"
                  )}
                >
                  {plan.ctaText}
                </Button>

                <p className="mt-2 text-center text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                  Garantia de 14 dias sem risco
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Botão para Expandir Tabela Comparativa Detalhada */}
      {showComparison && (
        <div className="mt-16 text-center">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsComparisonOpen(!isComparisonOpen)}
            className="text-xs font-semibold text-foreground hover:bg-muted/50 gap-2 border border-border/60"
          >
            <span>{isComparisonOpen ? "Ocultar Comparativo Detalhado de Recursos" : "Ver Comparativo Completo de Recursos"}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {isComparisonOpen ? "▲" : "▼"}
            </span>
          </Button>
        </div>
      )}

      {/* Tabela Comparativa Detalhada (Feature Comparison Matrix) */}
      {showComparison && isComparisonOpen && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/80 bg-muted/30">
                  <th className="p-4 text-xs font-bold text-foreground uppercase tracking-wider w-2/5">
                    Recurso / Capacidade
                  </th>
                  <th className="p-4 text-center text-xs font-bold text-foreground uppercase tracking-wider w-1/5">
                    Starter
                  </th>
                  <th className="p-4 text-center text-xs font-bold text-primary uppercase tracking-wider w-1/5 bg-primary/5">
                    Professional
                  </th>
                  <th className="p-4 text-center text-xs font-bold text-foreground uppercase tracking-wider w-1/5">
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-xs">
                {COMPARISON_TABLE.map((cat, catIdx) => (
                  <React.Fragment key={catIdx}>
                    <tr className="bg-muted/20">
                      <td
                        colSpan={4}
                        className="py-2.5 px-4 font-bold text-[11px] uppercase tracking-wider text-muted-foreground"
                      >
                        {cat.category}
                      </td>
                    </tr>
                    {cat.features.map((feat, featIdx) => (
                      <tr
                        key={featIdx}
                        className="hover:bg-muted/10 transition-colors"
                      >
                        <td className="p-4 font-medium text-foreground">
                          {feat.name}
                        </td>

                        {/* Starter */}
                        <td className="p-4 text-center">
                          {typeof feat.starter === "boolean" ? (
                            feat.starter ? (
                              <Check className="h-4 w-4 text-emerald-500 mx-auto" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                            )
                          ) : (
                            <span className="font-mono text-muted-foreground font-semibold">
                              {feat.starter}
                            </span>
                          )}
                        </td>

                        {/* Professional */}
                        <td className="p-4 text-center bg-primary/5 font-semibold text-foreground">
                          {typeof feat.professional === "boolean" ? (
                            feat.professional ? (
                              <Check className="h-4 w-4 text-emerald-500 mx-auto stroke-[2.5]" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                            )
                          ) : (
                            <span className="font-mono text-foreground font-bold">
                              {feat.professional}
                            </span>
                          )}
                        </td>

                        {/* Enterprise */}
                        <td className="p-4 text-center font-medium">
                          {typeof feat.enterprise === "boolean" ? (
                            feat.enterprise ? (
                              <Check className="h-4 w-4 text-emerald-500 mx-auto" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                            )
                          ) : (
                            <span className="font-mono text-foreground font-bold">
                              {feat.enterprise}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nota de rodapé da tabela de preços */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-emerald-500" /> Sem taxas de adesão
        </span>
        <span className="flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-emerald-500" /> Cancele quando quiser
        </span>
        <span className="flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-emerald-500" /> Faturamento via Boleto, PIX ou Cartão
        </span>
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" /> Dúvidas? Fale com nosso suporte
        </span>
      </div>
    </section>
  )
}

