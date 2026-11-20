export type TransactionType = "income" | "expense" | "transfer"

export type TransactionStatus = "completed" | "pending" | "cancelled"

export type PaymentMethod =
  | "pix"
  | "credit_card"
  | "bank_transfer"
  | "boleto"
  | "cash"

export interface Transaction {
  id: string
  description: string
  amount: number
  type: TransactionType
  category: string
  account: string
  paymentMethod: PaymentMethod
  status: TransactionStatus
  date: string // "YYYY-MM-DD"
  dueDate?: string // "YYYY-MM-DD"
  contactName?: string
  documentNumber?: string
  notes?: string
  tags?: string[]
  createdAt: string
}

export interface TransactionStatsSummary {
  totalIncome: number
  totalExpense: number
  balance: number
  pendingCount: number
  pendingAmount: number
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "Pix",
  credit_card: "Cartão de Crédito",
  bank_transfer: "Transferência TED",
  boleto: "Boleto Bancário",
  cash: "Dinheiro em Espécie",
}

export const CATEGORIES_BY_TYPE: Record<
  TransactionType,
  { id: string; name: string; iconName?: string }[]
> = {
  income: [
    { id: "vendas", name: "Vendas & Licenças" },
    { id: "servicos", name: "Prestação de Serviços" },
    { id: "assinaturas", name: "Assinaturas SaaS" },
    { id: "rendimentos", name: "Rendimentos & Investimentos" },
    { id: "outras_receitas", name: "Outras Receitas" },
  ],
  expense: [
    { id: "infraestrutura", name: "Infraestrutura & Nuvem" },
    { id: "software", name: "Softwares & Ferramentas" },
    { id: "salarios", name: "Salários & Pró-labore" },
    { id: "marketing", name: "Marketing & Publicidade" },
    { id: "impostos", name: "Impostos & Taxas" },
    { id: "escritorio", name: "Escritório & Operações" },
    { id: "outras_despesas", name: "Outras Despesas" },
  ],
  transfer: [
    { id: "transferencia_interna", name: "Transferência Entre Contas" },
    { id: "reserva", name: "Aporte em Reserva" },
    { id: "investimento", name: "Aplicação Financeira" },
  ],
}

export const DEFAULT_ACCOUNTS = [
  "Conta Principal Itaú",
  "Banco Inter PJ",
  "Nubank PJ",
  "Caixa Operacional",
  "Stripe / Gateway",
]

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

export function formatDateBR(dateStr: string): string {
  if (!dateStr) return "-"
  const [year, month, day] = dateStr.split("-")
  if (!year || !month || !day) return dateStr
  return `${day}/${month}/${year}`
}

export const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-101",
    description: "Mensalidade Contrato Enterprise — FinTech Brasil",
    amount: 14850.0,
    type: "income",
    category: "Assinaturas SaaS",
    account: "Conta Principal Itaú",
    paymentMethod: "pix",
    status: "completed",
    date: "2026-05-11",
    contactName: "FinTech Brasil S.A.",
    documentNumber: "NF-2026/0491",
    notes: "Pagamento referente à competência Maio/2026.",
    tags: ["Enterprise", "Recorrência"],
    createdAt: "2026-05-11T09:15:00Z",
  },
  {
    id: "tx-102",
    description: "Fatura AWS Cloud & Kubernetes Cluster",
    amount: 3420.5,
    type: "expense",
    category: "Infraestrutura & Nuvem",
    account: "Banco Inter PJ",
    paymentMethod: "credit_card",
    status: "completed",
    date: "2026-05-10",
    dueDate: "2026-05-10",
    contactName: "Amazon Web Services",
    documentNumber: "INV-AWS-8831",
    notes: "Consumo de instâncias EC2, RDS e tráfego de saída.",
    tags: ["Infra", "Mensal"],
    createdAt: "2026-05-10T14:30:00Z",
  },
  {
    id: "tx-103",
    description: "Consultoria em Arquitetura de Software e DevOps",
    amount: 7200.0,
    type: "income",
    category: "Prestação de Serviços",
    account: "Conta Principal Itaú",
    paymentMethod: "bank_transfer",
    status: "completed",
    date: "2026-05-09",
    contactName: "Nexus Logística Integrada",
    documentNumber: "NF-2026/0488",
    tags: ["Consultoria"],
    createdAt: "2026-05-09T16:00:00Z",
  },
  {
    id: "tx-104",
    description: "Assinatura GitHub Enterprise & Copilot seats",
    amount: 890.0,
    type: "expense",
    category: "Softwares & Ferramentas",
    account: "Banco Inter PJ",
    paymentMethod: "credit_card",
    status: "completed",
    date: "2026-05-08",
    contactName: "GitHub Inc.",
    tags: ["DevTools"],
    createdAt: "2026-05-08T11:20:00Z",
  },
  {
    id: "tx-105",
    description: "Licenciamento Anual de Software — Clínica Alpha",
    amount: 9600.0,
    type: "income",
    category: "Vendas & Licenças",
    account: "Conta Principal Itaú",
    paymentMethod: "boleto",
    status: "pending",
    date: "2026-05-15",
    dueDate: "2026-05-15",
    contactName: "Clínica Alpha Saúde",
    documentNumber: "BOL-99014",
    notes: "Aguardando compensação bancária prevista para 15/05.",
    tags: ["Anual", "Boleto"],
    createdAt: "2026-05-07T10:00:00Z",
  },
  {
    id: "tx-106",
    description: "Honorários Contabilidade e Assessoria Fiscal",
    amount: 1450.0,
    type: "expense",
    category: "Escritório & Operações",
    account: "Conta Principal Itaú",
    paymentMethod: "pix",
    status: "pending",
    date: "2026-05-18",
    dueDate: "2026-05-18",
    contactName: "Auditora & Associados Contábeis",
    documentNumber: "FAT-7712",
    notes: "Boleto emitido para pagamento no dia 18.",
    tags: ["Fixo", "Contabilidade"],
    createdAt: "2026-05-06T15:45:00Z",
  },
  {
    id: "tx-107",
    description: "Campanha Google Ads & Tráfego Pago B2B",
    amount: 2100.0,
    type: "expense",
    category: "Marketing & Publicidade",
    account: "Banco Inter PJ",
    paymentMethod: "credit_card",
    status: "completed",
    date: "2026-05-05",
    contactName: "Google Brasil Internet Ltda",
    tags: ["Ads", "Marketing"],
    createdAt: "2026-05-05T18:00:00Z",
  },
  {
    id: "tx-108",
    description: "Transferência para Reserva de Emergência e Rendimentos",
    amount: 5000.0,
    type: "transfer",
    category: "Aporte em Reserva",
    account: "Conta Principal Itaú",
    paymentMethod: "bank_transfer",
    status: "completed",
    date: "2026-05-04",
    notes: "Transferência de Itaú PJ para CDB Liquidez Diária Inter PJ.",
    tags: ["Reserva"],
    createdAt: "2026-05-04T08:30:00Z",
  },
  {
    id: "tx-109",
    description: "Assinatura Workspace e Licenças Figma Team",
    amount: 620.0,
    type: "expense",
    category: "Softwares & Ferramentas",
    account: "Banco Inter PJ",
    paymentMethod: "credit_card",
    status: "completed",
    date: "2026-05-03",
    contactName: "Figma Inc.",
    tags: ["Design", "SaaS"],
    createdAt: "2026-05-03T12:10:00Z",
  },
  {
    id: "tx-110",
    description: "Venda de Módulo de Integração ERP — Rede Óticas",
    amount: 4200.0,
    type: "income",
    category: "Vendas & Licenças",
    account: "Conta Principal Itaú",
    paymentMethod: "pix",
    status: "completed",
    date: "2026-05-02",
    contactName: "Rede Óticas Premium",
    documentNumber: "NF-2026/0479",
    tags: ["Implantação"],
    createdAt: "2026-05-02T17:25:00Z",
  },
]

