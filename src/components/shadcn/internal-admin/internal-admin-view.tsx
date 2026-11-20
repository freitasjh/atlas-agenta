import { useState, useMemo } from "react"
import { toast } from "sonner"
import {
  type TenantCompany,
  type PlanTier,
  type InternalAdminKpis,
  INITIAL_TENANTS,
  INITIAL_SAAS_KPIS,
} from "./internal-admin-types"
import { InternalAdminHeader } from "./internal-admin-header"
import { InternalAdminKpisComponent } from "./internal-admin-kpis"
import { TenantsTable } from "./tenants-table"
import { TenantDetailsSheet } from "./tenant-details-sheet"
import { NewTenantDialog } from "./new-tenant-dialog"
import { ImpersonateModal } from "./impersonate-modal"

interface InternalAdminViewProps {
  initialTenants?: TenantCompany[]
  initialKpis?: InternalAdminKpis
}

export function InternalAdminView({
  initialTenants = INITIAL_TENANTS,
  initialKpis = INITIAL_SAAS_KPIS,
}: InternalAdminViewProps) {
  const [tenants, setTenants] = useState<TenantCompany[]>(initialTenants)
  const [kpis, setKpis] = useState<InternalAdminKpis>(initialKpis)
  const [searchQuery, setSearchQuery] = useState("")
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Modais e Drawers
  const [activeTenant, setActiveTenant] = useState<TenantCompany | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isNewTenantOpen, setIsNewTenantOpen] = useState(false)
  const [impersonateTenant, setImpersonateTenant] = useState<TenantCompany | null>(null)
  const [isImpersonateOpen, setIsImpersonateOpen] = useState(false)

  // Filtragem de Busca
  const filteredTenants = useMemo(() => {
    if (!searchQuery.trim()) return tenants
    const q = searchQuery.toLowerCase()
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.subdomain.toLowerCase().includes(q) ||
        t.document.includes(q) ||
        t.ownerEmail.toLowerCase().includes(q) ||
        t.ownerName.toLowerCase().includes(q)
    )
  }, [tenants, searchQuery])

  // Handlers
  const handleRefresh = () => {
    setIsRefreshing(true)
    setTimeout(() => {
      setIsRefreshing(false)
      toast.success("Métricas de uso e faturamento dos tenants sincronizadas.")
    }, 600)
  }

  const handleExportReport = () => {
    toast.info("Exportando relatório consolidado de faturamento e quotas de SaaS...")
  }

  // Criação de Nova Empresa
  const handleCreateTenant = (tenantData: Partial<TenantCompany>) => {
    const newTenant: TenantCompany = {
      id: `tenant-${Date.now()}`,
      name: tenantData.name || "Nova Empresa",
      legalName: tenantData.legalName || "Razão Social",
      document: tenantData.document || "00.000.000/0001-00",
      subdomain: tenantData.subdomain || `tenant-${Date.now()}`,
      ownerName: tenantData.ownerName || "Administrador",
      ownerEmail: tenantData.ownerEmail || "admin@empresa.com.br",
      plan: tenantData.plan || "pro",
      billingCycle: tenantData.billingCycle || "monthly",
      mrr: tenantData.mrr || 1290.0,
      status: "active",
      createdAt: new Date().toISOString(),
      quota: tenantData.quota || {
        seatsUsed: 1,
        seatsTotal: 15,
        storageUsedGb: 1,
        storageTotalGb: 150,
        apiCallsMonthly: 0,
        apiCallsTotal: 300000,
      },
      activeModules: tenantData.activeModules || ["Multi-filiais"],
      pendingAlerts: [],
      invoices: [],
    }

    setTenants((prev) => [newTenant, ...prev])
    setKpis((prev) => ({
      ...prev,
      totalTenants: prev.totalTenants + 1,
      activeTenants: prev.activeTenants + 1,
      totalMrr: prev.totalMrr + newTenant.mrr,
    }))

    toast.success(`Empresa "${newTenant.name}" (${newTenant.subdomain}.atlas.app) cadastrada com sucesso!`)
  }

  // Acesso Impersonado
  const handleRequestImpersonate = (tenant: TenantCompany) => {
    setImpersonateTenant(tenant)
    setIsImpersonateOpen(true)
  }

  const handleConfirmImpersonate = (tenant: TenantCompany) => {
    toast.success(`Iniciando sessão administrativa na empresa "${tenant.name}" (${tenant.subdomain}.atlas.app)...`, {
      description: "Todas as ações realizadas ficam registradas na trilha de auditoria do super-admin.",
    })
  }

  // Alteração de Plano
  const handleChangePlan = (tenantId: string, newPlan: PlanTier) => {
    const planMrrMap: Record<PlanTier, number> = {
      starter: 490.0,
      pro: 1290.0,
      enterprise: 4890.0,
      custom: 7500.0,
    }

    const planSeatsMap: Record<PlanTier, number> = {
      starter: 5,
      pro: 15,
      enterprise: 50,
      custom: 100,
    }

    const planStorageMap: Record<PlanTier, number> = {
      starter: 50,
      pro: 150,
      enterprise: 500,
      custom: 1000,
    }

    setTenants((prev) =>
      prev.map((t) => {
        if (t.id === tenantId) {
          const deltaMrr = planMrrMap[newPlan] - t.mrr
          setKpis((k) => ({ ...k, totalMrr: k.totalMrr + deltaMrr }))
          return {
            ...t,
            plan: newPlan,
            mrr: planMrrMap[newPlan],
            quota: {
              ...t.quota,
              seatsTotal: planSeatsMap[newPlan],
              storageTotalGb: planStorageMap[newPlan],
            },
          }
        }
        return t
      })
    )

    if (activeTenant?.id === tenantId) {
      setActiveTenant((prev) =>
        prev
          ? {
              ...prev,
              plan: newPlan,
              mrr: planMrrMap[newPlan],
              quota: {
                ...prev.quota,
                seatsTotal: planSeatsMap[newPlan],
                storageTotalGb: planStorageMap[newPlan],
              },
            }
          : null
      )
    }

    toast.success(`Plano atualizado para ${newPlan.toUpperCase()} com sucesso!`)
  }

  // Extensão de Trial
  const handleExtendTrial = (tenantId: string) => {
    setTenants((prev) =>
      prev.map((t) => {
        if (t.id === tenantId) {
          const newEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
          return { ...t, trialEndsAt: newEnds }
        }
        return t
      })
    )
    toast.success("+14 dias concedidos ao período de avaliação da empresa!")
  }

  // Suspender / Reativar Tenant
  const handleToggleStatus = (tenantId: string) => {
    setTenants((prev) =>
      prev.map((t) => {
        if (t.id === tenantId) {
          const nextStatus = t.status === "suspended" ? "active" : "suspended"
          toast.info(nextStatus === "suspended" ? "Acesso da empresa suspenso." : "Acesso da empresa reativado.")
          return { ...t, status: nextStatus }
        }
        return t
      })
    )

    if (activeTenant?.id === tenantId) {
      setActiveTenant((prev) =>
        prev ? { ...prev, status: prev.status === "suspended" ? "active" : "suspended" } : null
      )
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 py-4">
      {/* Cabeçalho do Super Admin SaaS */}
      <InternalAdminHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenNewTenant={() => setIsNewTenantOpen(true)}
        onExportReport={handleExportReport}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* KPIs de Controle de Negócio & SaaS */}
      <InternalAdminKpisComponent kpis={kpis} />

      {/* Tabela de Empresas Clientes (Tenants) */}
      <div className="space-y-3">
        <TenantsTable
          tenants={filteredTenants}
          onOpenDetails={(t) => {
            setActiveTenant(t)
            setIsDetailsOpen(true)
          }}
          onImpersonate={handleRequestImpersonate}
          onExtendTrial={handleExtendTrial}
          onToggleStatus={handleToggleStatus}
        />
      </div>

      {/* Drawer de Detalhes, Consumo e Faturamento */}
      <TenantDetailsSheet
        tenant={activeTenant}
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        onImpersonate={handleRequestImpersonate}
        onChangePlan={handleChangePlan}
        onExtendTrial={handleExtendTrial}
        onToggleStatus={handleToggleStatus}
      />

      {/* Modal de Criação de Novo Tenant */}
      <NewTenantDialog
        open={isNewTenantOpen}
        onOpenChange={setIsNewTenantOpen}
        onCreateTenant={handleCreateTenant}
      />

      {/* Modal de Confirmação de Impersonate */}
      <ImpersonateModal
        tenant={impersonateTenant}
        open={isImpersonateOpen}
        onOpenChange={setIsImpersonateOpen}
        onConfirmImpersonate={handleConfirmImpersonate}
      />
    </div>
  )
}
