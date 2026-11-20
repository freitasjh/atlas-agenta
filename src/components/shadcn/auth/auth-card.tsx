import { cn } from "@/lib/cn"

/**
 * Card base das telas de autenticação (Arquétipo 5 de `DESIGN.md`).
 *
 * Casca sem padding próprio: as páginas mantêm `CardHeader`/`CardContent`/
 * `CardFooter` para preservar ritmo vertical e os contratos de teste. O que
 * este componente adiciona é o **rim light** superior do template e o raio
 * `rounded-2xl`, todos via tokens semânticos (zero hex/rgb).
 */
export function AuthCard({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs",
        "dark:border-border/60 dark:shadow-none",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
      />
      {children}
    </div>
  )
}
