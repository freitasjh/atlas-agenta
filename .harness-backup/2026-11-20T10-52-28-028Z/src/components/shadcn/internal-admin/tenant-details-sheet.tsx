import { useState } from "react"
import { 
  Globe, 
  ExternalLink, 
  Users, 
  HardDrive, 
  Activity, 
  CreditCard, 
  AlertTriangle, 
  Copy, 
  Check 
} from "lucide-react"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet"
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
  formatCurrencyBRL, 
  formatDateBR 
} from "./internal-admin-types"

interface TenantDetailsSheetProps {
  tenant: TenantCompany | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onImpersonate: (tenant: TenantCompany) => void
  onChangePlan: (tenantId: string, newPlan: PlanTier) => void
  onExtendTrial: (tenantId: string) => void
  onToggleStatus: (tenantId: string) => void
}

export function TenantDetailsSheet({
  tenant,
  open,
  onOpenChange,
  onImpersonate,
  onChangePlan,
  onExtendTrial,
  onToggleStatus,
}: TenantDetailsSheetProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "usage" | "billing">("overview")
  const [copiedSubdomain, setCopiedSubdomain] = useState(false)

  if (!tenant) return null

  const handleCopySubdomain = () => {
    navigator.clipboard.writeText(`https://${tenant.subdomain}.atlas.app`)
    setCopiedSubdomain(true)
    setTimeout(() => setCopiedSubdomain(false), 2000)
  }

  const seatsPercent = Math.round((tenant.quota.seatsUsed / tenant.quota.seatsTotal) * 100)
  const storagePercent = Math.round((tenant.quota.storageUsedGb / tenant.quota.storageTotalGb) * 100)
  const apiPercent = Math.round((tenant.quota.apiCallsMonthly / tenant.quota.apiCallsTotal) * 100)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-xl p-0 flex flex-col justify-between overflow-y-auto"
      >
        <div className="p-6 space-y-6">
          {/* Header do Drawer */}
          <SheetHeader className="space-y-1 text-left">
            <div className="flex items-center justify-between pr-6">
              <Badge 
                variant="outline" 
                className={`text-[10px] font-mono uppercase px-2 py-0.5 ${
                  tenant.status === "active"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : tenant.status === "trial"
                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                    : tenant.status === "past_due"
                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {tenant.status === "active" ? "Ativo" : tenant.status === "trial" ? "Período de Testes" : tenant.status === "past_due" ? "Fatura Atrasada" : "Suspenso"}
              </Badge>

              <Badge variant="secondary" className="text-xs uppercase font-bold">
                Plano {tenant.plan}
              </Badge>
            </div>

            <SheetTitle className="text-xl font-bold text-foreground leading-tight pt-1">
              {tenant.name}
            </SheetTitle>
            <p className="text-xs text-muted-foreground">
              {tenant.legalName}
            </p>
          </SheetHeader>

          {/* Subdomínio e Link Direto */}
          <div className="rounded-lg bg-muted/40 border border-border p-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary shrink-0" />
              <span className="font-mono font-medium text-foreground">
                https://{tenant.subdomain}.atlas.app
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopySubdomain}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                title="Copiar URL do tenant"
              >
                {copiedSubdomain ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onImpersonate(tenant)}
                className="h-7 px-2.5 text-xs gap-1.5 bg-background font-medium"
              >
                <ExternalLink className="h-3 w-3" />
                Acessar Ambiente
              </Button>
            </div>
          </div>

          {/* Alertas Ativos da Empresa */}
          {tenant.pendingAlerts.length > 0 && (
            <div className="space-y-2">
              {tenant.pendingAlerts.map((alt, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 flex items-start gap-2.5 text-xs ${
                    alt.severity === "critical"
                      ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{alt.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* Abas Internas do Drawer */}
          <div className="flex items-center gap-1 border-b border-border/80 pb-2">
            <Button
              type="button"
              variant={activeTab === "overview" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("overview")}
              className={`h-8 px-3 text-xs ${activeTab === "overview" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"}`}
            >
              Visão Geral
            </Button>
            <Button
              type="button"
              variant={activeTab === "usage" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("usage")}
              className={`h-8 px-3 text-xs ${activeTab === "usage" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"}`}
            >
              Quotas & Uso
            </Button>
            <Button
              type="button"
              variant={activeTab === "billing" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("billing")}
              className={`h-8 px-3 text-xs ${activeTab === "billing" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"}`}
            >
              Faturamento & MRR
            </Button>
          </div>

          {/* Conteúdo Aba: Visão Geral */}
          {activeTab === "overview" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border divide-y divide-border/60 text-xs">
                <div className="p-2.5 flex items-center justify-between">
                  <span className="text-muted-foreground">CNPJ</span>
                  <span className="font-mono font-medium text-foreground">{tenant.document}</span>
                </div>
                <div className="p-2.5 flex items-center justify-between">
                  <span className="text-muted-foreground">Administrador Responsável</span>
                  <span className="font-medium text-foreground">{tenant.ownerName}</span>
                </div>
                <div className="p-2.5 flex items-center justify-between">
                  <span className="text-muted-foreground">E-mail de Contato</span>
                  <span className="text-foreground">{tenant.ownerEmail}</span>
                </div>
                <div className="p-2.5 flex items-center justify-between">
                  <span className="text-muted-foreground">Cliente Desde</span>
                  <span className="font-mono text-muted-foreground">{formatDateBR(tenant.createdAt)}</span>
                </div>
              </div>

              {/* Módulos Contratados */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Módulos e Recursos Ativos ({tenant.activeModules.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {tenant.activeModules.map((mod) => (
                    <Badge key={mod} variant="secondary" className="text-xs py-0.5 px-2">
                      {mod}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Conteúdo Aba: Quotas & Consumo */}
          {activeTab === "usage" && (
            <div className="space-y-4 text-xs">
              {/* Usuários / Seats */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium flex items-center gap-1.5 text-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    Assentos de Usuários
                  </span>
                  <span className="font-mono font-bold text-foreground">
                    {tenant.quota.seatsUsed} / {tenant.quota.seatsTotal} ({seatsPercent}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full ${seatsPercent >= 90 ? "bg-rose-500" : seatsPercent >= 75 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, seatsPercent)}%` }}
                  />
                </div>
              </div>

              {/* Armazenamento */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium flex items-center gap-1.5 text-foreground">
                    <HardDrive className="h-4 w-4 text-primary" />
                    Armazenamento em Nuvem
                  </span>
                  <span className="font-mono font-bold text-foreground">
                    {tenant.quota.storageUsedGb} GB / {tenant.quota.storageTotalGb} GB ({storagePercent}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full ${storagePercent >= 90 ? "bg-rose-500" : storagePercent >= 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, storagePercent)}%` }}
                  />
                </div>
              </div>

              {/* Chamadas de API */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium flex items-center gap-1.5 text-foreground">
                    <Activity className="h-4 w-4 text-primary" />
                    Requisições de API no Mês
                  </span>
                  <span className="font-mono font-bold text-foreground">
                    {(tenant.quota.apiCallsMonthly / 1000).toFixed(0)}k / {(tenant.quota.apiCallsTotal / 1000).toFixed(0)}k ({apiPercent}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full ${apiPercent >= 90 ? "bg-rose-500" : apiPercent >= 75 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, apiPercent)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Conteúdo Aba: Faturamento & MRR */}
          {activeTab === "billing" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/30 border border-border p-3 flex items-center justify-between">
                <div>
                  <span className="text-xs text-muted-foreground block">Receita Recorrente (MRR)</span>
                  <span className="text-xl font-bold font-mono text-foreground">
                    {formatCurrencyBRL(tenant.mrr)}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Cobrança {tenant.billingCycle === "yearly" ? "Anual com desconto" : "Mensal"}
                  </span>
                </div>

                <div className="w-40">
                  <span className="text-[10px] text-muted-foreground block pb-1">Alterar Plano:</span>
                  <Select
                    value={tenant.plan}
                    onValueChange={(val) => onChangePlan(tenant.id, val as PlanTier)}
                  >
                    <SelectTrigger className="h-8 text-xs w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Histórico de Faturas */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5" />
                  Histórico de Faturas ({tenant.invoices.length})
                </h4>

                {tenant.invoices.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic p-2 bg-muted/20 rounded">
                    Nenhuma fatura gerada (empresa em período trial).
                  </p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border text-xs">
                    {tenant.invoices.map((inv) => (
                      <div key={inv.id} className="p-2.5 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-foreground">{inv.referenceMonth}</p>
                          <p className="text-[10px] text-muted-foreground">Vencimento: {formatDateBR(inv.dueDate)}</p>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <span className="font-mono font-bold text-foreground">
                            {formatCurrencyBRL(inv.amount)}
                          </span>
                          <Badge variant="outline" className={`text-[10px] ${
                            inv.status === "paid" ? "text-emerald-600 bg-emerald-500/10" : "text-rose-600 bg-rose-500/10"
                          }`}>
                            {inv.status === "paid" ? "Paga" : "Vencida"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé Fixo com Ações de Super-Admin */}
        <div className="p-4 border-t border-border bg-card space-y-2">
          <Button
            type="button"
            onClick={() => onImpersonate(tenant)}
            className="w-full gap-2 text-xs h-9 bg-amber-600 hover:bg-amber-700 text-white shadow-xs font-semibold"
          >
            <ExternalLink className="h-4 w-4" />
            Entrar no Painel como esta Empresa (Impersonate)
          </Button>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {tenant.status === "trial" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onExtendTrial(tenant.id)}
                className="gap-1.5 text-xs h-8"
              >
                +14 Dias de Trial
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => onToggleStatus(tenant.id)}
              className={`gap-1.5 text-xs h-8 ${tenant.status === "suspended" ? "text-emerald-600 hover:text-emerald-700" : "text-rose-600 hover:text-rose-700"}`}
            >
              {tenant.status === "suspended" ? "Reativar Tenant" : "Suspender Acesso"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
