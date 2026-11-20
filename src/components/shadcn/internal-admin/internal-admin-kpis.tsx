import { 
  Building2, 
  DollarSign, 
  Clock, 
  AlertTriangle, 
  TrendingUp, 
  Zap,
  CheckCircle2 
} from "lucide-react"
import { Card, CardContent } from "../ui/card"
import { Badge } from "../ui/badge"
import { 
  type InternalAdminKpis, 
  formatCurrencyBRL 
} from "./internal-admin-types"

interface InternalAdminKpisProps {
  kpis: InternalAdminKpis
}

export function InternalAdminKpisComponent({ kpis }: InternalAdminKpisProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {/* KPI 1: Total de Empresas */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Empresas Ativas</span>
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {kpis.activeTenants}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              De <strong className="text-foreground">{kpis.totalTenants} cadastradas</strong>
            </p>
          </div>
          <div className="pt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="h-3 w-3" />
            <span>91.8% de ativação geral</span>
          </div>
        </CardContent>
      </Card>

      {/* KPI 2: MRR Consolidado */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">MRR Consolidado</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono truncate" title={formatCurrencyBRL(kpis.totalMrr)}>
              {formatCurrencyBRL(kpis.totalMrr)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Receita mensal recorrente
            </p>
          </div>
          <div className="pt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            <TrendingUp className="h-3 w-3" />
            <span>+{kpis.mrrGrowthPercent}% MoM</span>
          </div>
        </CardContent>
      </Card>

      {/* KPI 3: Empresas em Trial */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Período de Testes</span>
            <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {kpis.trialsCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Empresas em avaliação gratuita
            </p>
          </div>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
              4 expiram em 72h
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* KPI 4: Inadimplência / Past Due */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Inadimplência (Dunning)</span>
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400 font-mono">
              {kpis.pastDueTenantsCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Empresas com faturas atrasadas
            </p>
          </div>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20">
              Régua de cobrança ativa
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* KPI 5: Quotas Críticas / Upsell */}
      <Card className="shadow-2xs border-border/70">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Quotas Críticas (≥85%)</span>
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Zap className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {kpis.criticalQuotaTenantsCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Oportunidades de Upsell
            </p>
          </div>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
              Uso global médio: {kpis.avgStorageUsagePercent}%
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

