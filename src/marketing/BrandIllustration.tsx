import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * Ilustração de marca — **decorativa** (ADR-02, RF12/RF14/CA11).
 *
 * Representa a tese do produto em miniatura: o ciclo
 * `lembrete no WhatsApp → pendente → confirmado → PIX pago`, ecoando o "anel de
 * confirmação" jade da marca (mesmo arco de `src/components/Logo.tsx`, via
 * `stroke="hsl(var(--primary))"`). Reusa `StatusBadge` para os estados
 * `pendente`/`confirmado` — tokens `--status-*`, nunca cor nova.
 *
 * Fonte única de markup reusada por **duas** telas (hero da landing e `aside`
 * do `AuthLayout`); a prop `variant` controla tamanho/densidade sem duplicar o
 * SVG. É **inteiramente decorativa**: o container raiz leva `aria-hidden="true"`
 * e nenhum texto essencial vive só dentro dela — o significado está no texto ao
 * redor de quem a consome.
 *
 * Sem `<img src=…>`, sem asset externo, sem dependência nova. Estática (sem
 * movimento), então nada a neutralizar por `prefers-reduced-motion`.
 */

type BrandIllustrationVariant = "hero" | "aside";

interface BrandIllustrationProps {
  /**
   * Densidade/escala: `"hero"` (maior, landing) ou `"aside"` (menor, painel de
   * login). Default `"hero"`.
   */
  variant?: BrandIllustrationVariant;
  className?: string;
}

/** Ajustes de escala por ponto de uso. */
const VARIANT_STYLES: Record<
  BrandIllustrationVariant,
  { ring: string; gap: string; pix: string; label: string }
> = {
  hero: {
    ring: "h-16 w-16",
    gap: "gap-3 p-5 sm:gap-4 sm:p-6",
    pix: "text-sm",
    label: "text-xs",
  },
  aside: {
    ring: "h-12 w-12",
    gap: "gap-2.5 p-4",
    pix: "text-xs",
    label: "text-[0.6875rem]",
  },
};

export function BrandIllustration({
  variant = "hero",
  className,
}: BrandIllustrationProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card",
        styles.gap,
        className,
      )}
    >
      {/* Linha 1: balão de WhatsApp — o lembrete que inicia o ciclo. */}
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Balão de conversa. */}
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5Z" />
          </svg>
        </span>
        <span
          className={cn(
            "rounded-xl rounded-tl-sm bg-muted px-3 py-2 font-medium text-muted-foreground",
            styles.label,
          )}
        >
          Confirma seu horário de amanhã?
        </span>
      </div>

      {/* Linha 2: a transição de estado — o coração do produto. */}
      <div className="flex items-center gap-2">
        <StatusBadge status="pendente" />
        {/* Seta decorativa. */}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0"
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        <StatusBadge status="confirmado" />
      </div>

      {/* Linha 3: selo de PIX pago — o anel de confirmação jade fecha o ciclo. */}
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10",
            styles.ring,
          )}
        >
          <svg
            viewBox="0 0 32 32"
            className="h-3/5 w-3/5"
            fill="none"
          >
            {/* Anel de confirmação: arco aberto em jade (linguagem da marca). */}
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
        </span>
        <span className={cn("font-medium text-foreground", styles.pix)}>
          PIX recebido
        </span>
      </div>
    </div>
  );
}
