export type CaseCategory = "kyc" | "fraud_alert" | "chargeback" | "limit_increase"
export type RiskLevel = "low" | "medium" | "critical"
export type CaseStatus = "pending" | "in_review" | "approved" | "rejected"
export type OperatorStatus = "available" | "in_case" | "break" | "offline"

export interface Operator {
  id: string
  name: string
  email: string
  avatar?: string
  role: string
}

export interface AttachedDocument {
  id: string
  name: string
  type: string
  url: string
  status: "verified" | "pending" | "rejected"
  ocrExtractedText?: Record<string, string>
}

export interface TimelineEvent {
  id: string
  timestamp: string
  actor: string
  action: string
  details?: string
  riskDelta?: number
}

export interface QueueCase {
  id: string
  protocolNumber: string
  category: CaseCategory
  customerName: string
  customerDocument: string // CPF ou CNPJ
  customerEmail: string
  accountType: "PJ" | "PF"
  riskScore: number // 0 a 100
  riskLevel: RiskLevel
  status: CaseStatus
  amount?: number
  assignedTo?: Operator
  createdAt: string
  slaDeadline: string
  slaRemainingMinutes: number
  summary: string
  documents: AttachedDocument[]
  timeline: TimelineEvent[]
}

export interface AuditLogEntry {
  id: string
  timestamp: string
  operatorName: string
  operatorRole: string
  action: string
  targetResource: string
  targetId: string
  ipAddress: string
  status: "success" | "warning" | "error"
  reasonCode?: string
  justification?: string
}

export interface ServiceHealth {
  id: string
  name: string
  category: "gateway" | "compliance" | "banking" | "messaging"
  status: "operational" | "degraded" | "down"
  latencyMs: number
  uptimePercent: number
  lastCheck: string
}

export interface BackofficeMetrics {
  pendingCasesCount: number
  avgWaitTimeMinutes: number
  slaCompliancePercent: number
  fraudAlertsCount: number
  avgRiskScore: number
  activeDisputesAmount: number
  disputesCount: number
  systemUptimePercent: number
  avgGatewayLatencyMs: number
}

// Utilitários de Formatação
export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

export function formatDateTimeBR(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

// Operadores mockados
export const OPERATORS: Operator[] = [
  { id: "op-1", name: "Sarah Torres", email: "sarah.torres@atlas.com.br", role: "Especialista de Risco Sênior" },
  { id: "op-2", name: "Felipe Mendes", email: "felipe.mendes@atlas.com.br", role: "Analista de KYC & Compliance" },
  { id: "op-3", name: "Camila Rocha", email: "camila.rocha@atlas.com.br", role: "Supervisora de Operações" },
]

// Casos iniciais realistas da fila
export const INITIAL_QUEUE_CASES: QueueCase[] = [
  {
    id: "case-101",
    protocolNumber: "OP-2026-8941",
    category: "fraud_alert",
    customerName: "Logística Express do Brasil Ltda",
    customerDocument: "42.189.304/0001-92",
    customerEmail: "financeiro@logisticaexpress.com.br",
    accountType: "PJ",
    riskScore: 88,
    riskLevel: "critical",
    status: "in_review",
    amount: 85400.0,
    assignedTo: OPERATORS[0],
    createdAt: "2026-11-12T07:15:00Z",
    slaDeadline: "2026-11-12T09:15:00Z",
    slaRemainingMinutes: 34,
    summary: "Discrepância de geolocalização e transações sucessivas atípicas via Pix em horário não comercial.",
    documents: [
      {
        id: "doc-1",
        name: "Contrato_Social_Consolidado.pdf",
        type: "pdf",
        url: "#",
        status: "verified",
        ocrExtractedText: {
          RazaoSocial: "Logística Express do Brasil Ltda",
          CapitalSocial: "R$ 500.000,00",
          SocioAdministrador: "Marcio Roberto Silveira",
        },
      },
      {
        id: "doc-2",
        name: "Comprovante_Faturamento_DRE_Q3.pdf",
        type: "pdf",
        url: "#",
        status: "pending",
      },
    ],
    timeline: [
      {
        id: "t-1",
        timestamp: "2026-11-12T07:15:00Z",
        actor: "Motor Antifraude (Regra R-402)",
        action: "Alerta de Fraude Disparado",
        details: "Score elevado para 88 devido a 3 transações de alto valor em menos de 10 minutos.",
        riskDelta: 45,
      },
      {
        id: "t-2",
        timestamp: "2026-11-12T07:30:00Z",
        actor: "Sarah Torres",
        action: "Caso Atribuído para Análise",
        details: "Iniciada verificação de histórico e contato com o titular cadastrado.",
      },
    ],
  },
  {
    id: "case-102",
    protocolNumber: "OP-2026-8942",
    category: "kyc",
    customerName: "Beatriz Helena Albuquerque",
    customerDocument: "284.910.488-30",
    customerEmail: "beatriz.albuquerque@gmail.com",
    accountType: "PF",
    riskScore: 32,
    riskLevel: "low",
    status: "pending",
    amount: 12000.0,
    createdAt: "2026-11-12T07:45:00Z",
    slaDeadline: "2026-11-12T11:45:00Z",
    slaRemainingMinutes: 184,
    summary: "Validação cadastral de novo onboarding de conta digital com biometria facial concluída com 97.4% de match.",
    documents: [
      {
        id: "doc-3",
        name: "CNH_Digital_Frente_Verso.jpg",
        type: "image",
        url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80",
        status: "verified",
        ocrExtractedText: {
          NomeCompleto: "Beatriz Helena Albuquerque",
          CPF: "284.910.488-30",
          DataNascimento: "14/08/1991",
        },
      },
    ],
    timeline: [
      {
        id: "t-3",
        timestamp: "2026-11-12T07:45:00Z",
        actor: "API Onboarding",
        action: "Submissão de Documentos",
        details: "Documento CNH processado por OCR e biometria aprovada.",
      },
    ],
  },
  {
    id: "case-103",
    protocolNumber: "OP-2026-8943",
    category: "chargeback",
    customerName: "TechStore Eletrônicos S.A.",
    customerDocument: "18.902.114/0001-05",
    customerEmail: "chargebacks@techstore.com.br",
    accountType: "PJ",
    riskScore: 64,
    riskLevel: "medium",
    status: "in_review",
    amount: 14890.0,
    assignedTo: OPERATORS[1],
    createdAt: "2026-11-12T06:30:00Z",
    slaDeadline: "2026-11-13T18:00:00Z",
    slaRemainingMinutes: 1680,
    summary: "Disputa de cartão de crédito (Motivo 4837 - Fraude não reconhecida pelo portador) para compra de laptops corporativos.",
    documents: [
      {
        id: "doc-4",
        name: "Nota_Fiscal_Eletronica_54091.pdf",
        type: "pdf",
        url: "#",
        status: "verified",
      },
      {
        id: "doc-5",
        name: "Comprovante_Entrega_Assinado_Transportadora.pdf",
        type: "pdf",
        url: "#",
        status: "pending",
      },
    ],
    timeline: [
      {
        id: "t-4",
        timestamp: "2026-11-12T06:30:00Z",
        actor: "Adquirente Cielo / Visa",
        action: "Disputa Aberta",
        details: "Notificação de chargeback de R$ 14.890,00 recebida via webhook.",
      },
    ],
  },
  {
    id: "case-104",
    protocolNumber: "OP-2026-8944",
    category: "limit_increase",
    customerName: "Inovare Consultoria & Soluções Digitais",
    customerDocument: "31.402.991/0001-81",
    customerEmail: "diretoria@inovaresolucoes.com.br",
    accountType: "PJ",
    riskScore: 24,
    riskLevel: "low",
    status: "pending",
    amount: 150000.0,
    createdAt: "2026-11-12T08:00:00Z",
    slaDeadline: "2026-11-12T14:00:00Z",
    slaRemainingMinutes: 320,
    summary: "Solicitação de aumento de limite diário Pix de R$ 50.000,00 para R$ 150.000,00 para folha de pagamento.",
    documents: [
      {
        id: "doc-6",
        name: "Balancete_Auditado_2026.pdf",
        type: "pdf",
        url: "#",
        status: "verified",
      },
    ],
    timeline: [
      {
        id: "t-5",
        timestamp: "2026-11-12T08:00:00Z",
        actor: "Portal Internet Banking",
        action: "Solicitação Registrada",
        details: "Cliente enviou comprovantes contábeis solicitando novo limite operacional.",
      },
    ],
  },
  {
    id: "case-105",
    protocolNumber: "OP-2026-8945",
    category: "fraud_alert",
    customerName: "Claudio Ramos de Medeiros",
    customerDocument: "092.341.804-11",
    customerEmail: "claudio.medeiros@yahoo.com.br",
    accountType: "PF",
    riskScore: 92,
    riskLevel: "critical",
    status: "pending",
    amount: 29500.0,
    createdAt: "2026-11-12T08:15:00Z",
    slaDeadline: "2026-11-12T09:45:00Z",
    slaRemainingMinutes: 60,
    summary: "Conta recém-criada efetuando saques e transferências para conta de destino listada em base de risco.",
    documents: [],
    timeline: [
      {
        id: "t-6",
        timestamp: "2026-11-12T08:15:00Z",
        actor: "Motor Antifraude (Regra R-108)",
        action: "Bloqueio Preventivo",
        details: "Chave Pix de destino identificada em lista de contestação do Banco Central.",
        riskDelta: 70,
      },
    ],
  },
]

// Logs de Auditoria
export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: "log-1",
    timestamp: "2026-11-12T08:22:15Z",
    operatorName: "Sarah Torres",
    operatorRole: "Especialista de Risco",
    action: "Bloqueio Temporário de Conta",
    targetResource: "Conta Corrente PJ",
    targetId: "42.189.304/0001-92",
    ipAddress: "192.168.1.140",
    status: "warning",
    reasonCode: "FRAUD_SUSPICION",
    justification: "Bloqueio preventivo cautelar após detecção de anomalia de padrão transacional.",
  },
  {
    id: "log-2",
    timestamp: "2026-11-12T08:05:40Z",
    operatorName: "Felipe Mendes",
    operatorRole: "Analista de KYC",
    action: "Aprovação Cadastral (KYC Nível 2)",
    targetResource: "Usuário PF",
    targetId: "284.910.488-30",
    ipAddress: "192.168.1.144",
    status: "success",
    justification: "Documentos e biometria conferidos em conformidade com a Circular BACEN.",
  },
  {
    id: "log-3",
    timestamp: "2026-11-12T07:40:10Z",
    operatorName: "Camila Rocha",
    operatorRole: "Supervisora de Operações",
    action: "Envio de Defesa de Chargeback",
    targetResource: "Disputa Adquirente",
    targetId: "DISP-99201",
    ipAddress: "192.168.1.112",
    status: "success",
    justification: "Juntada de comprovante de entrega assinado e rastreio dos Correios.",
  },
]

// Monitoramento de Saúde de Serviços
export const INITIAL_SERVICES_HEALTH: ServiceHealth[] = [
  {
    id: "srv-1",
    name: "Conector SPI / Pix BACEN",
    category: "banking",
    status: "operational",
    latencyMs: 94,
    uptimePercent: 99.99,
    lastCheck: "Há 1 minuto",
  },
  {
    id: "srv-2",
    name: "Gateway Adquirência & Cartões",
    category: "gateway",
    status: "operational",
    latencyMs: 142,
    uptimePercent: 99.95,
    lastCheck: "Há 30 segundos",
  },
  {
    id: "srv-3",
    name: "Motor de Análise de Risco & Antifraude",
    category: "compliance",
    status: "operational",
    latencyMs: 185,
    uptimePercent: 99.98,
    lastCheck: "Há 45 segundos",
  },
  {
    id: "srv-4",
    name: "Serviço de Webhooks & Mensageria",
    category: "messaging",
    status: "degraded",
    latencyMs: 420,
    uptimePercent: 99.40,
    lastCheck: "Há 2 minutos",
  },
]

// Métricas de Operações
export const INITIAL_BACKOFFICE_METRICS: BackofficeMetrics = {
  pendingCasesCount: 28,
  avgWaitTimeMinutes: 14,
  slaCompliancePercent: 98.2,
  fraudAlertsCount: 8,
  avgRiskScore: 48,
  activeDisputesAmount: 38450.0,
  disputesCount: 6,
  systemUptimePercent: 99.98,
  avgGatewayLatencyMs: 135,
}

