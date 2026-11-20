import * as React from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/shadcn/ui/button"
import { cn } from "@/lib/cn"

export type CtaBannerCta = {
  label: React.ReactNode
  to?: string
  href?: string
  onClick?: () => void
  variant?: "primary" | "secondary"
  icon?: React.ReactNode
}

export type CtaBannerProps = {
  badge?: React.ReactNode
  headline: React.ReactNode
  subheadline?: React.ReactNode
  primaryCta?: CtaBannerCta
  secondaryCta?: CtaBannerCta
  className?: string
}

function renderCta(cta: CtaBannerCta, fallback: "primary" | "secondary") {
  const variant = cta.variant ?? fallback
  const buttonVariant = variant === "primary" ? "default" : "outline"
  const content = (
    <>
      <span>{cta.label}</span>
      {cta.icon}
    </>
  )

  if (cta.to) {
    return (
      <Button
        asChild
        variant={buttonVariant}
        size="lg"
        className="h-11 px-8 text-sm font-semibold shadow-md gap-2"
      >
        <Link to={cta.to} onClick={cta.onClick}>
          {content}
        </Link>
      </Button>
    )
  }

  if (cta.href) {
    return (
      <Button
        asChild
        variant={buttonVariant}
        size="lg"
        className="h-11 px-8 text-sm font-semibold shadow-md gap-2"
      >
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
      className="h-11 px-8 text-sm font-semibold shadow-md gap-2"
    >
      {content}
    </Button>
  )
}

export function CtaBanner({
  badge,
  headline,
  subheadline,
  primaryCta,
  secondaryCta,
  className,
}: CtaBannerProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60 bg-card py-12 text-center",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent" />

      <div className="mx-auto max-w-4xl px-4">
        {badge ? (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">
            {badge}
          </div>
        ) : null}

        <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          {headline}
        </h2>

        {subheadline ? (
          <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {subheadline}
          </p>
        ) : null}

        {(primaryCta || secondaryCta) && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {primaryCta ? renderCta(primaryCta, "primary") : null}
            {secondaryCta ? renderCta(secondaryCta, "secondary") : null}
          </div>
        )}
      </div>
    </section>
  )
}


