export type PlanTier = "starter" | "pro" | "enterprise" | "custom"
export type TenantStatus = "active" | "trial" | "past_due" | "suspended" | "canceled"
export type BillingCycle = "monthly" | "yearly"

export interface QuotaUsage {
  seatsUsed: number
  seatsTotal: number
  storageUsedGb: number
  storageTotalGb: number
  apiCallsMonthly: number
  apiCallsTotal: number
}

export interface TenantInvoice {
  id: string
  referenceMonth: string
  amount: number
  status: "paid" | "open" | "overdue"
  dueDate: string
  paidAt?: string
}

export interface TenantCompany {
  id: string
  name: string
  legalName: string
  document: string // CNPJ
  subdomain: string // ex: novatech.atlas.app
  ownerName: string
  ownerEmail: string
  plan: PlanTier
  billingCycle: BillingCycle
  mrr: number // Mensalidade recorrente em R$
  status: TenantStatus
  trialEndsAt?: string
  createdAt: string
  quota: QuotaUsage
  activeModules: string[] // ex: ["Multi-filiais", "API Connect", "SSO SAML", "IA Analytics"]
  pendingAlerts: {
    type: "overdue_invoice" | "quota_limit" | "trial_expiring" | "compliance"
    message: string
    severity: "warning" | "critical" | "info"
  }[]
  invoices: TenantInvoice[]
}

export interface InternalAdminKpis {
  totalTenants: number
  activeTenants: number
  totalMrr: number
  mrrGrowthPercent: number
  trialsCount: number
  pastDueTenantsCount: number
  criticalQuotaTenantsCount: number
  avgStorageUsagePercent: number
}

// Utilitários de Formatação
export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

export function formatDateBR(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

// Mock inicial realista de empresas/tenants
export const INITIAL_TENANTS: TenantCompany[] = [
  {
    id: "tenant-1",
    name: "NovaTech Logística",
    legalName: "NovaTech Soluções Logísticas e Transportes S.A.",
    document: "14.281.992/0001-34",
    subdomain: "novatech",
    ownerName: "Rodrigo Mendonça",
    ownerEmail: "rodrigo.mendonca@novatech.com.br",
    plan: "enterprise",
    billingCycle: "yearly",
    mrr: 4890.0,
    status: "active",
    createdAt: "2025-04-10T10:00:00Z",
    quota: {
      seatsUsed: 42,
      seatsTotal: 50,
      storageUsedGb: 380,
      storageTotalGb: 500,
      apiCallsMonthly: 840000,
      apiCallsTotal: 1000000,
    },
    activeModules: ["Multi-filiais", "API Connect", "SSO SAML", "IA Analytics", "Auditoria Avançada"],
    pendingAlerts: [
      {
        type: "quota_limit",
        message: "Armazenamento atingiu 76% da quota contratada.",
        severity: "info",
      },
    ],
    invoices: [
      { id: "inv-01", referenceMonth: "Novembro/2026", amount: 4890.0, status: "paid", dueDate: "2026-11-05", paidAt: "2026-11-04" },
      { id: "inv-02", referenceMonth: "Outubro/2026", amount: 4890.0, status: "paid", dueDate: "2026-10-05", paidAt: "2026-10-05" },
    ],
  },
  {
    id: "tenant-2",
    name: "FinPulse Banking Solutions",
    legalName: "FinPulse Tecnologia e Meios de Pagamento Ltda",
    document: "38.109.442/0001-09",
    subdomain: "finpulse",
    ownerName: "Camila Guimarães",
    ownerEmail: "camila@finpulse.io",
    plan: "enterprise",
    billingCycle: "monthly",
    mrr: 7500.0,
    status: "active",
    createdAt: "2025-08-15T14:30:00Z",
    quota: {
      seatsUsed: 78,
      seatsTotal: 80,
      storageUsedGb: 920,
      storageTotalGb: 1000,
      apiCallsMonthly: 1950000,
      apiCallsTotal: 2000000,
    },
    activeModules: ["Multi-filiais", "API Connect", "SSO SAML", "Webhooks Dedicados"],
    pendingAlerts: [
      {
        type: "quota_limit",
        message: "Assentos em 97% e API em 97.5%. Tenant elegível para upsell imediato.",
        severity: "critical",
      },
    ],
    invoices: [
      { id: "inv-03", referenceMonth: "Novembro/2026", amount: 7500.0, status: "paid", dueDate: "2026-11-10", paidAt: "2026-11-09" },
    ],
  },
  {
    id: "tenant-3",
    name: "BioSaúde Clínicas Integradas",
    legalName: "BioSaúde Gestão Médica e Diagnósticos Ltda",
    document: "21.904.381/0001-82",
    subdomain: "biosaude",
    ownerName: "Dr. Marcelo Castilho",
    ownerEmail: "marcelo.castilho@biosaude.med.br",
    plan: "pro",
    billingCycle: "monthly",
    mrr: 1290.0,
    status: "past_due",
    createdAt: "2026-02-01T09:00:00Z",
    quota: {
      seatsUsed: 14,
      seatsTotal: 15,
      storageUsedGb: 88,
      storageTotalGb: 150,
      apiCallsMonthly: 120000,
      apiCallsTotal: 300000,
    },
    activeModules: ["Agenda Médica", "Prontuário Digital", "WhatsApp Bot"],
    pendingAlerts: [
      {
        type: "overdue_invoice",
        message: "Fatura de Novembro vencida há 7 dias (R$ 1.290,00). Régua de cobrança D+7 acionada.",
        severity: "critical",
      },
    ],
    invoices: [
      { id: "inv-04", referenceMonth: "Novembro/2026", amount: 1290.0, status: "overdue", dueDate: "2026-11-05" },
      { id: "inv-05", referenceMonth: "Outubro/2026", amount: 1290.0, status: "paid", dueDate: "2026-10-05", paidAt: "2026-10-05" },
    ],
  },
  {
    id: "tenant-4",
    name: "Vanguard Arquitetura & Engenharia",
    legalName: "Vanguard Projetos e Construções Civis Eireli",
    document: "09.412.871/0001-65",
    subdomain: "vanguard-eng",
    ownerName: "Fernanda Silveira",
    ownerEmail: "fernanda@vanguardeng.com.br",
    plan: "starter",
    billingCycle: "monthly",
    mrr: 490.0,
    status: "trial",
    trialEndsAt: "2026-11-15T23:59:59Z",
    createdAt: "2026-11-01T11:20:00Z",
    quota: {
      seatsUsed: 4,
      seatsTotal: 5,
      storageUsedGb: 12,
      storageTotalGb: 50,
      apiCallsMonthly: 15000,
      apiCallsTotal: 100000,
    },
    activeModules: ["Gestão de Obras", "Contratos"],
    pendingAlerts: [
      {
        type: "trial_expiring",
        message: "Período de testes expira em 3 dias. Nenhum cartão de crédito cadastrado ainda.",
        severity: "warning",
      },
    ],
    invoices: [],
  },
  {
    id: "tenant-5",
    name: "Distribuidora Aliança Sul",
    legalName: "Aliança Sul Alimentos e Bebidas Atacado S.A.",
    document: "03.882.109/0001-44",
    subdomain: "aliancasul",
    ownerName: "Carlos Alberto Neves",
    ownerEmail: "carlos.neves@aliancasul.com.br",
    plan: "enterprise",
    billingCycle: "yearly",
    mrr: 3900.0,
    status: "suspended",
    createdAt: "2025-01-20T08:00:00Z",
    quota: {
      seatsUsed: 30,
      seatsTotal: 30,
      storageUsedGb: 280,
      storageTotalGb: 300,
      apiCallsMonthly: 500000,
      apiCallsTotal: 500000,
    },
    activeModules: ["Multi-filiais", "WMS Logístico", "API Connect"],
    pendingAlerts: [
      {
        type: "overdue_invoice",
        message: "Acesso temporariamente suspenso por 2 faturas em aberto. Solicitação de renegociação em análise.",
        severity: "critical",
      },
    ],
    invoices: [
      { id: "inv-06", referenceMonth: "Novembro/2026", amount: 3900.0, status: "overdue", dueDate: "2026-11-01" },
      { id: "inv-07", referenceMonth: "Outubro/2026", amount: 3900.0, status: "overdue", dueDate: "2026-10-01" },
    ],
  },
  {
    id: "tenant-6",
    name: "EducaTech Plataforma de Cursos",
    legalName: "EducaTech Soluções EAD e Treinamentos Ltda",
    document: "27.441.205/0001-90",
    subdomain: "educatech",
    ownerName: "Juliana Peixoto",
    ownerEmail: "juliana@educatech.com.br",
    plan: "pro",
    billingCycle: "yearly",
    mrr: 1590.0,
    status: "active",
    createdAt: "2025-11-10T15:00:00Z",
    quota: {
      seatsUsed: 18,
      seatsTotal: 25,
      storageUsedGb: 195,
      storageTotalGb: 250,
      apiCallsMonthly: 410000,
      apiCallsTotal: 600000,
    },
    activeModules: ["Video Hosting", "Gamificação", "Certificados Digitais"],
    pendingAlerts: [],
    invoices: [
      { id: "inv-08", referenceMonth: "Novembro/2026", amount: 1590.0, status: "paid", dueDate: "2026-11-10", paidAt: "2026-11-08" },
    ],
  },
]

// KPIs Globais de SaaS
export const INITIAL_SAAS_KPIS: InternalAdminKpis = {
  totalTenants: 148,
  activeTenants: 136,
  totalMrr: 284500.0,
  mrrGrowthPercent: 8.4,
  trialsCount: 12,
  pastDueTenantsCount: 4,
  criticalQuotaTenantsCount: 7,
  avgStorageUsagePercent: 68.2,
}

