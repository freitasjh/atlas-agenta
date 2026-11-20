import * as React from "react"

import { Star } from "lucide-react"

import { cn } from "@/lib/cn"

export type TestimonialCardProps = {
  quote: React.ReactNode
  name: React.ReactNode
  role?: React.ReactNode
  initials?: React.ReactNode
  avatarClassName?: string
  className?: string
}

export function TestimonialCard({
  quote,
  name,
  role,
  initials,
  avatarClassName,
  className,
}: TestimonialCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
      <div>
        <div className="flex items-center gap-1 text-amber-500 mb-3" role="img" aria-label="5 de 5 estrelas">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className="h-4 w-4 fill-amber-500" aria-hidden="true" />
          ))}
        </div>
        <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed italic">
          {quote}
        </p>
      </div>

      <div className="mt-6 pt-4 border-t border-border/50 flex items-center gap-3">
        {initials ? (
          <div
            className={cn(
              "h-10 w-10 rounded-full font-bold flex items-center justify-center text-xs",
              avatarClassName ?? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            )}
          >
            {initials}
          </div>
        ) : null}
        <div>
          <p className="text-xs font-bold text-foreground">{name}</p>
          {role ? (
            <p className="text-[11px] text-muted-foreground">{role}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
