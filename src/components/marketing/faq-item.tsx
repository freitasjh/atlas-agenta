import * as React from "react"

import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/cn"

export type FaqItemProps = {
  question: React.ReactNode
  answer: React.ReactNode
  defaultOpen?: boolean
  className?: string
}

export function FaqItem({ question, answer, defaultOpen, className }: FaqItemProps) {
  const ref = React.useRef<HTMLDetailsElement>(null)

  React.useEffect(() => {
    if (ref.current && defaultOpen) {
      ref.current.open = true
    }
  }, [defaultOpen])

  return (
    <details
      ref={ref}
      className={cn("group rounded-xl border border-border/70 bg-card", className)}
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-5 py-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background list-none [&::-webkit-details-marker]:hidden">
        <span>{question}</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="px-5 pb-4 text-sm text-muted-foreground">{answer}</div>
    </details>
  )
}
