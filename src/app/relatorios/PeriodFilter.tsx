import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Filtro de período do relatório (ADR-08). Presets "Este mês / Mês passado /
 * Personalizado" + dois `<input type="date">`, no padrão de filtro da
 * `DashboardPage`/`AgendaPage`. Componente controlado: o pai detém o estado
 * (`start`/`end`, ambos `YYYY-MM-DD` no fuso do tenant) e a derivação dos
 * presets, mantendo a matemática de fuso fora daqui.
 *
 * Acessível: cada `Input` tem `Label` associado por `htmlFor`; presets são
 * botões navegáveis por teclado com estado ativo (`aria-pressed`).
 */

export type PeriodPreset = "mes" | "mes-passado" | "personalizado";

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "mes", label: "Este mês" },
  { value: "mes-passado", label: "Mês passado" },
  { value: "personalizado", label: "Personalizado" },
];

export function PeriodFilter({
  preset,
  start,
  end,
  onPresetChange,
  onStartChange,
  onEndChange,
}: {
  preset: PeriodPreset;
  start: string;
  end: string;
  onPresetChange: (preset: PeriodPreset) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Período do relatório"
      >
        {PRESETS.map((option) => {
          const active = preset === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => onPresetChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2 sm:max-w-md",
          // Datas só editáveis no preset personalizado; nos presets fixos
          // seguem refletindo o intervalo, mas em leitura.
          preset !== "personalizado" && "opacity-70",
        )}
      >
        <div className="space-y-1">
          <Label htmlFor="relatorio-inicio">Início</Label>
          <Input
            id="relatorio-inicio"
            type="date"
            value={start}
            max={end || undefined}
            disabled={preset !== "personalizado"}
            onChange={(event) => onStartChange(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="relatorio-fim">Fim</Label>
          <Input
            id="relatorio-fim"
            type="date"
            value={end}
            min={start || undefined}
            disabled={preset !== "personalizado"}
            onChange={(event) => onEndChange(event.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
