import { cn } from "@/lib/utils";

interface LogoProps {
  /** Esconde o texto e mostra só a marca (útil em sidebars colapsadas). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Marca do Atlas Agenda. A assinatura visual é o "anel de confirmação":
 * um arco jade que não se fecha, evocando o estado "confirmado" — o coração
 * do produto (reduzir no-show).
 */
export function Logo({ iconOnly = false, className }: LogoProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      aria-label="Atlas Agenda"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-7 w-7 shrink-0"
        role="img"
        aria-hidden="true"
        fill="none"
      >
        {/* Anel de confirmação: arco aberto em jade. */}
        <path
          d="M26 16a10 10 0 1 0-4.2 8.14"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Marca de confirmação no centro. */}
        <path
          d="M11.5 16.5l3 3 6-6.5"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!iconOnly && (
        <span className="font-display text-lg font-semibold tracking-tight">
          Atlas Agenda
        </span>
      )}
    </span>
  );
}
