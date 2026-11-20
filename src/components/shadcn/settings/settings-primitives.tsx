import type { ReactNode } from "react"
import { cn } from "@/lib/cn"

/** Cartão de seção: título + descrição + linhas de configuração. */
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-xs",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  )
}

/** Linha de configuração: rótulo/ajuda à esquerda, controle à direita. */
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  stacked = false,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
  /** Controle abaixo do texto (campos largos). */
  stacked?: boolean
}) {
  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3.5 sm:px-5",
        stacked
          ? "flex-col"
          : "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      )}
    >
      <div className="min-w-0 sm:max-w-[55%]">
        <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className={cn("min-w-0", stacked ? "w-full" : "w-full sm:w-64 sm:shrink-0")}>
        {children}
      </div>
    </div>
  )
}

/** Cabeçalho de página de seção. */
export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

