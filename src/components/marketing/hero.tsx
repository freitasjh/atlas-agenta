import * as React from "react"
import { Link } from "react-router-dom"
import { Check, ChevronRight } from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import { cn } from "@/lib/cn"

export type HeroCta = {
  label: React.ReactNode
  to?: string
  href?: string
  onClick?: () => void
  variant?: "primary" | "secondary"
  icon?: React.ReactNode
}

export type HeroTrustPill = React.ReactNode

export type HeroProps = {
  chip?: React.ReactNode
  headline: React.ReactNode
  subheadline: React.ReactNode
  primaryCta: HeroCta
  secondaryCta?: HeroCta
  trustPills?: HeroTrustPill[]
  /** Conteúdo extra dentro do hero (ex.: showcase interativo do template). */
  children?: React.ReactNode
  className?: string
}

function renderCta(cta: HeroCta, fallbackVariant: "primary" | "secondary") {
  const variant = cta.variant ?? fallbackVariant
  const buttonVariant = variant === "primary" ? "default" : "outline"
  const content = (
    <>
      <span>{cta.label}</span>
      {cta.icon}
    </>
  )

  if (cta.to) {
    return (
      <Button asChild variant={buttonVariant} size="lg" className="h-11 px-6 text-sm font-semibold shadow-md gap-2">
        <Link to={cta.to} onClick={cta.onClick}>
          {content}
        </Link>
      </Button>
    )
  }

  if (cta.href) {
    return (
      <Button asChild variant={buttonVariant} size="lg" className="h-11 px-6 text-sm font-semibold shadow-md gap-2">
        <a href={cta.href} onClick={cta.onClick}>
          {content}
        </a>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant={buttonVariant}
      size="lg"
      onClick={cta.onClick}
      className="h-11 px-6 text-sm font-semibold shadow-md gap-2"
    >
      {content}
    </Button>
  )
}

export function Hero({
  chip,
  headline,
  subheadline,
  primaryCta,
  secondaryCta,
  trustPills,
  children,
  className,
}: HeroProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden pt-12 pb-20 sm:pt-16 sm:pb-28",
        className,
      )}
    >
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[700px] rounded-full bg-primary/5 blur-3xl" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        {chip ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/40 px-3.5 py-1 text-xs font-medium text-foreground shadow-2xs mb-6 hover:bg-muted/60 transition-colors">
            {chip}
            <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </div>
        ) : null}

        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl leading-[1.15]">
          {headline}
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-sm sm:text-base text-muted-foreground leading-relaxed">
          {subheadline}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {renderCta(primaryCta, "primary")}
          {secondaryCta ? renderCta(secondaryCta, "secondary") : null}
        </div>

        {trustPills && trustPills.length > 0 ? (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
            {trustPills.map((pill, index) => (
              <span key={index} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-500 stroke-[2.5]" aria-hidden="true" />
                {pill}
              </span>
            ))}
          </div>
        ) : null}

        {children}
      </div>
    </section>
  )
}
