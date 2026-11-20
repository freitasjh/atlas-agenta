import { Server } from "lucide-react"
import { Badge } from "../ui/badge"
import { type ServiceHealth } from "./backoffice-types"

interface ServicesHealthCardProps {
  services: ServiceHealth[]
}

export function ServicesHealthCard({ services }: ServicesHealthCardProps) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-5 space-y-4 shadow-2xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">
              Monitoramento de Gateways & Microsserviços
            </h3>
            <p className="text-xs text-muted-foreground">
              Status operacional em tempo real dos conectores bancários e esteiras de mensageria
            </p>
          </div>
        </div>

        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
          Uptime Médio: 99.98%
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
        {services.map((srv) => (
          <div
            key={srv.id}
            className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-xs text-foreground truncate" title={srv.name}>
                {srv.name}
              </span>
              {srv.status === "operational" && (
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Operacional" />
              )}
              {srv.status === "degraded" && (
                <span className="flex h-2 w-2 rounded-full bg-amber-500 shrink-0" title="Degradado" />
              )}
              {srv.status === "down" && (
                <span className="flex h-2 w-2 rounded-full bg-rose-500 shrink-0" title="Fora do ar" />
              )}
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-[11px] text-muted-foreground">Latência:</span>
              <span className={`font-mono font-bold ${
                srv.latencyMs > 300
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}>
                {srv.latencyMs}ms
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-1.5">
              <span>Disponibilidade:</span>
              <span className="font-mono text-foreground font-medium">{srv.uptimePercent}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
