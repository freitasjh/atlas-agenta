import { HardDrive, Zap } from "lucide-react"
import { Button } from "../ui/button"
import { 
  type StorageOverviewData, 
  formatBytes 
} from "./file-manager-types"

interface FileStorageWidgetProps {
  data: StorageOverviewData
  onUpgrade?: () => void
}

export function FileStorageWidget({ data, onUpgrade }: FileStorageWidgetProps) {
  const percentUsed = Math.round((data.usedCapacity / data.totalCapacity) * 100)
  const availableBytes = Math.max(0, data.totalCapacity - data.usedCapacity)

  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:p-6 shadow-sm space-y-6">
      {/* Header do Widget */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-foreground">
              Armazenamento em Nuvem
            </h3>
            <p className="text-xs text-muted-foreground">
              {formatBytes(data.usedCapacity)} usados de {formatBytes(data.totalCapacity)} ({percentUsed}%)
            </p>
          </div>
        </div>

        {onUpgrade && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onUpgrade}
            className="h-8 text-xs gap-1.5"
          >
            <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
            Upgrade
          </Button>
        )}
      </div>

      {/* Barra de Progresso Multi-Segmentada */}
      <div className="space-y-2">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/60 p-0.5">
          {data.categories.map((cat) => {
            const catPercent = (cat.size / data.totalCapacity) * 100
            return (
              <div
                key={cat.type}
                className="h-full rounded-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${catPercent}%`,
                  backgroundColor: cat.color,
                }}
                title={`${cat.label}: ${formatBytes(cat.size)} (${catPercent.toFixed(1)}%)`}
              />
            )
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Disponível: <strong className="text-foreground">{formatBytes(availableBytes)}</strong></span>
          <span>Capacidade Máxima: <strong className="text-foreground">{formatBytes(data.totalCapacity)}</strong></span>
        </div>
      </div>

      {/* Grid de Categorias */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2">
        {data.categories.map((category) => (
          <div
            key={category.type}
            className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: category.color }}
              />
              <span className="text-xs font-medium text-foreground truncate">
                {category.label}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-foreground">
                {formatBytes(category.size)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {category.totalFiles} arquivos
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
