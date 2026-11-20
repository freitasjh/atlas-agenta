import * as React from "react"

import { cn } from "@/lib/cn"

export type SocialProofProps = {
  eyebrow?: React.ReactNode
  logos: React.ReactNode[]
  className?: string
}

export function SocialProof({ eyebrow, logos, className }: SocialProofProps) {
  return (
    <section
      className={cn(
        "border-y border-border/60 bg-muted/20 py-10",
        className,
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-8 sm:gap-14 opacity-70 grayscale transition-all hover:opacity-100 hover:grayscale-0">
          {logos.map((logo, index) => (
            <span
              key={index}
              className="font-mono text-base font-bold tracking-tight text-foreground"
            >
              {logo}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
