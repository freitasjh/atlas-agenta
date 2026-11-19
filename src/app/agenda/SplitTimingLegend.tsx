import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Legenda colapsável do split-timing (ADR-11): faixa sólida jade (atendimento)
 * + faixa listrada âmbar (processamento). Respeita `prefers-reduced-motion`.
 */
export function SplitTimingLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Legenda
        <ChevronDown
          className={cn("h-4 w-4 motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-4">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-3 w-6 rounded-sm bg-emerald-500" />
            Atendimento
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-6 rounded-sm bg-amber-400"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.15) 4px, rgba(0,0,0,0.15) 8px)",
              }}
            />
            Processamento
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default SplitTimingLegend;