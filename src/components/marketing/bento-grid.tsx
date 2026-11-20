import * as React from "react"

import { cn } from "@/lib/cn"

export type BentoGridProps = {
  id?: string
  eyebrow?: React.ReactNode
  headline?: React.ReactNode
  subheadline?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function BentoGrid({
  id,
  eyebrow,
  headline,
  subheadline,
  children,
  className,
}: BentoGridProps) {
  return (
    <section id={id} className={cn("py-20 sm:py-28", className)}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {(eyebrow || headline || subheadline) && (
          <div className="text-center max-w-3xl mx-auto mb-16">
            {eyebrow ? (
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                {eyebrow}
              </span>
            ) : null}
            {headline ? (
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                {headline}
              </h2>
            ) : null}
            {subheadline ? (
              <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
                {subheadline}
              </p>
            ) : null}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">{children}</div>
      </div>
    </section>
  )
}
