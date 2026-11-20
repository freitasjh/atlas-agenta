import { 
  Users, 
  Clock, 
  ShieldAlert, 
  AlertOctagon, 
  Activity, 
  TrendingUp, 
  CheckCircle2 
} from "lucide-react"
import { Card, CardContent } from "../ui/card"
import { Badge } from "../ui/badge"
import { 
  type BackofficeMetrics, 
  formatCurrencyBRL 
} from "./backoffice-types"

interface BackofficeKpisProps {
  metrics: BackofficeMetrics
}

export function BackofficeKpis({ metrics }: BackofficeKpisProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {/* KPI 1: Fila de Casos Pendentes */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Fila Pendente</span>
            <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {metrics.pendingCasesCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Espera média: <strong className="text-foreground">{metrics.avgWaitTimeMinutes} min</strong>
            </p>
          </div>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
              Dentro da capacidade
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* KPI 2: Resolução dentro do SLA */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">SLA de Resolução</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {metrics.slaCompliancePercent}%
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Meta contratual: <strong className="text-foreground">≥ 95.0%</strong>
            </p>
          </div>
          <div className="pt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="h-3 w-3" />
            <span>+1.4% vs semana anterior</span>
          </div>
        </CardContent>
      </Card>

      {/* KPI 3: Alertas Críticos de Risco */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Risco & Fraude</span>
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <ShieldAlert className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {metrics.fraudAlertsCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Score médio: <strong className="text-rose-600 dark:text-rose-400">{metrics.avgRiskScore}/100</strong>
            </p>
          </div>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20">
              Ação imediata requerida
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* KPI 4: Disputas & Chargebacks */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Disputas Abertas</span>
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertOctagon className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono truncate" title={formatCurrencyBRL(metrics.activeDisputesAmount)}>
              {formatCurrencyBRL(metrics.activeDisputesAmount)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              <strong className="text-foreground">{metrics.disputesCount} casos</strong> em contestação
            </p>
          </div>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
              Prazo limite médio: 28h
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* KPI 5: Saúde dos Gateways */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Uptime de Gateways</span>
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Activity className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {metrics.systemUptimePercent}%
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Latência média: <strong className="text-foreground">{metrics.avgGatewayLatencyMs}ms</strong>
            </p>
          </div>
          <div className="pt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            <TrendingUp className="h-3 w-3" />
            <span>99.99% no SPI Pix</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

