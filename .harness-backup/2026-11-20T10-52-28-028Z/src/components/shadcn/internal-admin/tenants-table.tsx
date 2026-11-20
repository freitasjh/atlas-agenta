import { useState } from "react"
import { 
  MoreVertical, 
  ExternalLink, 
  Globe, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Eye, 
  ShieldAlert 
} from "lucide-react"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { 
  type TenantCompany, 
  type PlanTier, 
  type TenantStatus,
  formatCurrencyBRL 
} from "./internal-admin-types"

interface TenantsTableProps {
  tenants: TenantCompany[]
  onOpenDetails: (tenant: TenantCompany) => void
  onImpersonate: (tenant: TenantCompany) => void
  onExtendTrial: (tenantId: string) => void
  onToggleStatus: (tenantId: string) => void
}

export function TenantsTable({
  tenants,
  onOpenDetails,
  onImpersonate,
  onExtendTrial,
  onToggleStatus,
}: TenantsTableProps) {
  const [activeTab, setActiveTab] = useState<"all" | "active" | "trial" | "past_due" | "critical_quota">("all")
  const [planFilter, setPlanFilter] = useState<PlanTier | "all">("all")

  // Filtragem
  const filteredTenants = tenants.filter((t) => {
    if (activeTab === "active" && t.status !== "active") return false
    if (activeTab === "trial" && t.status !== "trial") return false
    if (activeTab === "past_due" && t.status !== "past_due" && t.status !== "suspended") return false
    if (activeTab === "critical_quota") {
      const seatsP = (t.quota.seatsUsed / t.quota.seatsTotal) * 100
      const storageP = (t.quota.storageUsedGb / t.quota.storageTotalGb) * 100
      if (seatsP < 80 && storageP < 80) return false
    }
    if (planFilter !== "all" && t.plan !== planFilter) return false
    return true
  })

  const tabs: { key: typeof activeTab; label: string; count: number }[] = [
    { key: "all", label: "Todas as Empresas", count: tenants.length },
    { key: "active", label: "Ativas", count: tenants.filter((t) => t.status === "active").length },
    { key: "trial", label: "Em Teste (Trial)", count: tenants.filter((t) => t.status === "trial").length },
    { key: "past_due", label: "Inadimplentes / Pendentes", count: tenants.filter((t) => t.status === "past_due" || t.status === "suspended").length },
    {
      key: "critical_quota",
      label: "Quotas Críticas (≥80%)",
      count: tenants.filter((t) => (t.quota.seatsUsed / t.quota.seatsTotal) >= 0.8 || (t.quota.storageUsedGb / t.quota.storageTotalGb) >= 0.8).length,
    },
  ]

  const statusBadgeMap: Record<TenantStatus, { label: string; class: string }> = {
    active: { label: "Ativo", class: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    trial: { label: "Trial", class: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    past_due: { label: "Fatura Atrasada", class: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
    suspended: { label: "Suspenso", class: "bg-muted text-muted-foreground" },
    canceled: { label: "Cancelado", class: "bg-muted text-muted-foreground" },
  }

  return (
    <div className="space-y-4">
      {/* Abas e Filtros Rápidos */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              type="button"
              variant={activeTab === tab.key ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={`h-8 px-3 text-xs gap-1.5 rounded-lg ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] rounded-full px-1.5 py-0.2 ${
                activeTab === tab.key
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}>
                {tab.count}
              </span>
            </Button>
          ))}
        </div>

        {/* Filtro por Plano */}
        <div className="w-36 self-end sm:self-auto">
          <Select
            value={planFilter}
            onValueChange={(val) => setPlanFilter(val as PlanTier | "all")}
          >
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder="Filtrar Plano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Planos</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabela de Tenants */}
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-2xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[180px] sm:min-w-[240px] font-semibold text-xs pl-4">Empresa / Subdomínio</TableHead>
              <TableHead className="w-28 sm:w-36 font-semibold text-xs">Plano & MRR</TableHead>
              <TableHead className="w-24 sm:w-32 font-semibold text-xs">Status</TableHead>
              <TableHead className="w-36 font-semibold text-xs hidden md:table-cell">Assentos (Seats)</TableHead>
              <TableHead className="w-36 font-semibold text-xs hidden lg:table-cell">Storage</TableHead>
              <TableHead className="min-w-[180px] font-semibold text-xs hidden xl:table-cell">Pendências / Alertas</TableHead>
              <TableHead className="w-16 sm:w-24 pr-4 text-right font-semibold text-xs"></TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredTenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  Nenhuma empresa encontrada com os filtros selecionados.
                </TableCell>
              </TableRow>
            ) : (
              filteredTenants.map((t) => {
                const statusInfo = statusBadgeMap[t.status]
                const seatsP = Math.round((t.quota.seatsUsed / t.quota.seatsTotal) * 100)
                const storageP = Math.round((t.quota.storageUsedGb / t.quota.storageTotalGb) * 100)

                return (
                  <TableRow
                    key={t.id}
                    className="group hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => onOpenDetails(t)}
                  >
                    {/* Nome, Subdomínio e CNPJ */}
                    <TableCell className="pl-4">
                      <div className="space-y-0.5">
                        <p className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                          {t.name}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                          <span className="flex items-center gap-1 text-primary/80">
                            <Globe className="h-3 w-3" />
                            {t.subdomain}.atlas.app
                          </span>
                          <span>•</span>
                          <span>{t.document}</span>
                        </div>
                      </div>
                    </TableCell>

                    {/* Plano & MRR */}
                    <TableCell>
                      <div className="space-y-0.5">
                        <span className="font-mono font-bold text-xs text-foreground block">
                          {formatCurrencyBRL(t.mrr)}
                        </span>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono py-0 h-4 bg-muted/30">
                          {t.plan}
                        </Badge>
                      </div>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${statusInfo.class}`}>
                        {statusInfo.label}
                      </Badge>
                    </TableCell>

                    {/* Assentos */}
                    <TableCell className="hidden md:table-cell">
                      <div className="space-y-1 w-28">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-muted-foreground">{t.quota.seatsUsed}/{t.quota.seatsTotal}</span>
                          <span className="font-semibold text-foreground">{seatsP}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${seatsP >= 90 ? "bg-rose-500" : seatsP >= 80 ? "bg-amber-500" : "bg-primary"}`}
                            style={{ width: `${Math.min(100, seatsP)}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>

                    {/* Armazenamento */}
                    <TableCell className="hidden lg:table-cell">
                      <div className="space-y-1 w-28">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-muted-foreground">{t.quota.storageUsedGb}/{t.quota.storageTotalGb}GB</span>
                          <span className="font-semibold text-foreground">{storageP}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${storageP >= 90 ? "bg-rose-500" : storageP >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${Math.min(100, storageP)}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>

                    {/* Pendências / Alertas */}
                    <TableCell className="hidden xl:table-cell">
                      {t.pendingAlerts.length > 0 ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${
                            t.pendingAlerts[0].severity === "critical" ? "text-rose-500" : "text-amber-500"
                          }`} />
                          <span className={`text-[11px] truncate max-w-xs ${
                            t.pendingAlerts[0].severity === "critical" ? "text-rose-600 dark:text-rose-400 font-medium" : "text-amber-600 dark:text-amber-400"
                          }`}>
                            {t.pendingAlerts[0].message}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          Em conformidade
                        </span>
                      )}
                    </TableCell>

                    {/* Ações */}
                    <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onImpersonate(t)}
                          className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                          title="Acessar como empresa (Impersonate)"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                              <span className="sr-only">Opções</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => onOpenDetails(t)} className="gap-2 cursor-pointer">
                              <Eye className="h-4 w-4" />
                              Ver Detalhes do Tenant
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onImpersonate(t)} className="gap-2 text-amber-600 dark:text-amber-400 cursor-pointer">
                              <ExternalLink className="h-4 w-4" />
                              Impersonar Acesso
                            </DropdownMenuItem>
                            {t.status === "trial" && (
                              <DropdownMenuItem onClick={() => onExtendTrial(t.id)} className="gap-2 cursor-pointer">
                                <Clock className="h-4 w-4" />
                                +14 Dias de Trial
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onToggleStatus(t.id)} className={`gap-2 cursor-pointer ${
                              t.status === "suspended" ? "text-emerald-600" : "text-destructive"
                            }`}>
                              <ShieldAlert className="h-4 w-4" />
                              {t.status === "suspended" ? "Reativar Empresa" : "Suspender Acesso"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
