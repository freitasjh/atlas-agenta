import * as React from "react"

import { cn } from "@/lib/cn"

const SPAN_CLASS: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
  7: "md:col-span-7",
  8: "md:col-span-8",
  9: "md:col-span-9",
  10: "md:col-span-10",
  11: "md:col-span-11",
  12: "md:col-span-12",
}

export type BentoCardProps = {
  icon?: React.ReactNode
  iconClassName?: string
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  colSpan?: number
  className?: string
}

export function BentoCard({
  icon,
  iconClassName,
  title,
  description,
  children,
  colSpan,
  className,
}: BentoCardProps) {
  const spanClass = colSpan ? (SPAN_CLASS[colSpan] ?? "") : ""

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs",
        spanClass,
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
      <div>
        {icon ? (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg mb-4",
              iconClassName ?? "bg-primary/10 text-primary",
            )}
          >
            {icon}
          </div>
        ) : null}
        <h3 className="text-xl font-bold tracking-tight text-foreground">
          {title}
        </h3>
        {description ? (
          <p className="mt-2 text-xs text-muted-foreground sm:text-sm leading-relaxed max-w-xl">
            {description}
          </p>
        ) : null}
      </div>

      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  )
}
