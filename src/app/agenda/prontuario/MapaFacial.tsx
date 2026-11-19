import { cn } from "@/lib/utils";
import {
  useMapaFacial,
  ZONAS_FACIAIS,
} from "@/app/agenda/prontuario/useMapaFacial";

interface MapaFacialProps {
  customerId: string;
  appointmentId: string;
  canWrite: boolean;
  enabled: boolean;
}

/**
 * Mapa facial (UX-SPEC T1 item 5 + ajuste 8): rosto em SVG decorativo
 * (`aria-hidden`) + cada zona como `<button>` nativo ≥44px com nome acessível
 * (`aria-pressed`), + lista textual espelhada (fonte para leitor de tela).
 */
export function MapaFacial({ customerId, appointmentId, canWrite, enabled }: MapaFacialProps) {
  const { selecionadas, toggleZona } = useMapaFacial({ customerId, appointmentId, enabled });

  return (
    <section aria-label="Mapa facial" className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">Mapa facial</h4>

      <div role="group" aria-label="Zonas do rosto" className="relative mx-auto w-full max-w-xs">
        <svg viewBox="0 0 200 260" aria-hidden="true" focusable="false" className="h-auto w-full">
          <ellipse cx="100" cy="130" rx="70" ry="100" className="fill-muted/30 stroke-border" strokeWidth="2" />
          <ellipse cx="72" cy="105" rx="12" ry="8" className="stroke-border" fill="none" strokeWidth="1.5" />
          <ellipse cx="128" cy="105" rx="12" ry="8" className="stroke-border" fill="none" strokeWidth="1.5" />
          <line x1="100" y1="115" x2="100" y2="150" className="stroke-border" strokeWidth="1.5" />
          <ellipse cx="100" cy="175" rx="22" ry="10" className="stroke-border" fill="none" strokeWidth="1.5" />
        </svg>
        {ZONAS_FACIAIS.map((zona) => {
          const marcada = selecionadas.includes(zona.id);
          return (
            <button
              key={zona.id}
              type="button"
              aria-label={zona.nome}
              aria-pressed={marcada}
              disabled={!canWrite}
              onClick={() => toggleZona(zona.id)}
              style={{ left: zona.left, top: zona.top, width: zona.width, height: zona.height }}
              className={cn(
                "absolute min-h-[44px] min-w-[44px] rounded-full border-2 text-transparent transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-60",
                marcada
                  ? "border-primary bg-primary/30"
                  : "border-border bg-background/40 hover:border-primary/60",
              )}
            >
              <span aria-hidden="true" className="sr-only">
                {zona.nome}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1">
        <h5 className="text-sm font-medium text-foreground">Zonas registradas</h5>
        <ul aria-label="Zonas registradas" className="divide-y divide-border rounded-md border border-border">
          {ZONAS_FACIAIS.map((zona) => {
            const marcada = selecionadas.includes(zona.id);
            return (
              <li
                key={zona.id}
                data-testid={`zona-lista-${zona.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="text-foreground">
                  {zona.nome} — {marcada ? "marcada" : "não marcada"}
                </span>
                <button
                  type="button"
                  aria-label={`${marcada ? "Desmarcar" : "Marcar"} ${zona.nome}`}
                  aria-pressed={marcada}
                  disabled={!canWrite}
                  onClick={() => toggleZona(zona.id)}
                  className="min-h-[44px] rounded-md border border-border px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {marcada ? "Desmarcar" : "Marcar"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export { ZONAS_FACIAIS };
