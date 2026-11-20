export type BankAccountType =
  | "checking" // Conta Corrente
  | "savings" // Poupança
  | "investment" // Investimento / Tesouraria
  | "wallet" // Carteira Digital / Gateway (Mercado Pago, Stripe, etc)
  | "physical_cash" // Caixa Físico / Cofre

export type BankConnectionStatus =
  | "connected" // Open Finance ativo e sincronizado
  | "syncing" // Sincronizando
  | "error" // Necessita reconectar
  | "manual" // Sem Open Finance, importação manual (OFX)

export type BankInstitutionCode =
  | "itau"
  | "bradesco"
  | "santander"
  | "bb"
  | "nubank"
  | "inter"
  | "btg"
  | "caixa"
  | "cora"
  | "mercadopago"
  | "stripe"
  | "cash"

export interface BankInstitutionInfo {
  code: BankInstitutionCode
  name: string
  compe: string
  color: string
  lightBg: string
  iconInitials: string
}

export interface BankAccount {
  id: string
  nickname: string
  institution: BankInstitutionCode
  type: BankAccountType
  agency: string
  accountNumber: string
  accountDigit: string
  currentBalance: number
  reconciledBalance: number
  blockedBalance: number
  isDefault: boolean
  connectionStatus: BankConnectionStatus
  lastSyncAt: string
  colorTheme?: string
}

export type TransactionType = "credit" | "debit" | "transfer_in" | "transfer_out"

export type ReconciliationStatus = "reconciled" | "pending" | "divergent"

export interface BankStatementTransaction {
  id: string
  accountId: string
  date: string
  description: string
  category: string
  counterparty?: string
  amount: number
  type: TransactionType
  reconciliationStatus: ReconciliationStatus
  documentNumber?: string
  hasAttachment?: boolean
}

export interface TreasuryMetrics {
  totalConsolidatedBalance: number
  totalAvailableBalance: number
  totalBlockedBalance: number
  projectedInflow15Days: number
  projectedOutflow15Days: number
  monthYieldCDI: number
  yieldPercentageCDI: number
}

export const BANK_INSTITUTIONS: Record<BankInstitutionCode, BankInstitutionInfo> = {
  itau: {
    code: "itau",
    name: "Banco Itaú Unibanco",
    compe: "341",
    color: "#EC7000",
    lightBg: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
    iconInitials: "IT",
  },
  bradesco: {
    code: "bradesco",
    name: "Banco Bradesco",
    compe: "237",
    color: "#CC092F",
    lightBg: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    iconInitials: "BR",
  },
  santander: {
    code: "santander",
    name: "Banco Santander Brasil",
    compe: "033",
    color: "#EC0000",
    lightBg: "bg-red-600/10 text-red-600 dark:text-red-400 border-red-600/30",
    iconInitials: "ST",
  },
  bb: {
    code: "bb",
    name: "Banco do Brasil",
    compe: "001",
    color: "#F8D117",
    lightBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    iconInitials: "BB",
  },
  nubank: {
    code: "nubank",
    name: "Nubank PJ",
    compe: "260",
    color: "#8A05BE",
    lightBg: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
    iconInitials: "NU",
  },
  inter: {
    code: "inter",
    name: "Banco Inter Empresas",
    compe: "077",
    color: "#FF7A00",
    lightBg: "bg-orange-600/10 text-orange-600 dark:text-orange-400 border-orange-600/30",
    iconInitials: "IN",
  },
  btg: {
    code: "btg",
    name: "BTG Pactual Empresas",
    compe: "208",
    color: "#001E62",
    lightBg: "bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-600/30",
    iconInitials: "BTG",
  },
  caixa: {
    code: "caixa",
    name: "Caixa Econômica Federal",
    compe: "104",
    color: "#0066B3",
    lightBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
    iconInitials: "CEF",
  },
  cora: {
    code: "cora",
    name: "Cora Conta PJ",
    compe: "403",
    color: "#FE3E6D",
    lightBg: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30",
    iconInitials: "CO",
  },
  mercadopago: {
    code: "mercadopago",
    name: "Mercado Pago Gateway",
    compe: "323",
    color: "#009EE3",
    lightBg: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
    iconInitials: "MP",
  },
  stripe: {
    code: "stripe",
    name: "Stripe Payments Brasil",
    compe: "---",
    color: "#635BFF",
    lightBg: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
    iconInitials: "STP",
  },
  cash: {
    code: "cash",
    name: "Caixa Físico / Cofre",
    compe: "---",
    color: "#10B981",
    lightBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    iconInitials: "CX",
  },
}

export const MOCK_BANK_ACCOUNTS: BankAccount[] = [
  {
    id: "acc-1",
    nickname: "Itaú • Operacional Matriz",
    institution: "itau",
    type: "checking",
    agency: "1234",
    accountNumber: "56789",
    accountDigit: "0",
    currentBalance: 184520.4,
    reconciledBalance: 184520.4,
    blockedBalance: 0,
    isDefault: true,
    connectionStatus: "connected",
    lastSyncAt: "Há 8 minutos",
  },
  {
    id: "acc-2",
    nickname: "Nubank PJ • Cobranças & Pix",
    institution: "nubank",
    type: "checking",
    agency: "0001",
    accountNumber: "9876543",
    accountDigit: "2",
    currentBalance: 62410.8,
    reconciledBalance: 61890.8,
    blockedBalance: 0,
    isDefault: false,
    connectionStatus: "connected",
    lastSyncAt: "Há 15 minutos",
  },
  {
    id: "acc-3",
    nickname: "BTG Pactual • Tesouraria & CDI",
    institution: "btg",
    type: "investment",
    agency: "0001",
    accountNumber: "45210",
    accountDigit: "8",
    currentBalance: 420000.0,
    reconciledBalance: 420000.0,
    blockedBalance: 50000.0,
    isDefault: false,
    connectionStatus: "connected",
    lastSyncAt: "Hoje, 09:12",
  },
  {
    id: "acc-4",
    nickname: "Bradesco • Folha de Pagamento",
    institution: "bradesco",
    type: "checking",
    agency: "2345",
    accountNumber: "34567",
    accountDigit: "1",
    currentBalance: 35120.0,
    reconciledBalance: 35120.0,
    blockedBalance: 0,
    isDefault: false,
    connectionStatus: "manual",
    lastSyncAt: "OFX Importado ontem",
  },
  {
    id: "acc-5",
    nickname: "Stripe • Saldo a Repassar",
    institution: "stripe",
    type: "wallet",
    agency: "0001",
    accountNumber: "STRIPE-BR",
    accountDigit: "0",
    currentBalance: 18340.5,
    reconciledBalance: 18340.5,
    blockedBalance: 2500.0,
    isDefault: false,
    connectionStatus: "connected",
    lastSyncAt: "Há 3 minutos",
  },
  {
    id: "acc-6",
    nickname: "Caixa Físico • Tesouraria Loja 01",
    institution: "cash",
    type: "physical_cash",
    agency: "---",
    accountNumber: "GAVETA-01",
    accountDigit: "X",
    currentBalance: 4850.0,
    reconciledBalance: 4850.0,
    blockedBalance: 0,
    isDefault: false,
    connectionStatus: "manual",
    lastSyncAt: "Conferido hoje 08:30",
  },
]

export const MOCK_BANK_TRANSACTIONS: BankStatementTransaction[] = [
  {
    id: "tx-1",
    accountId: "acc-1",
    date: "13/11/2026",
    description: "Recebimento PIX - Fatura #4829 Nexus Tech",
    category: "Receita de Vendas",
    counterparty: "Nexus Tech Serviços Ltda",
    amount: 14250.0,
    type: "credit",
    reconciliationStatus: "reconciled",
    documentNumber: "E20261113094829",
    hasAttachment: true,
  },
  {
    id: "tx-2",
    accountId: "acc-1",
    date: "13/11/2026",
    description: "Pagamento Boleto - AWS Cloud Hosting",
    category: "Infraestrutura / Cloud",
    counterparty: "Amazon Web Services Brasil",
    amount: -3450.8,
    type: "debit",
    reconciliationStatus: "reconciled",
    documentNumber: "BOL-984210",
    hasAttachment: true,
  },
  {
    id: "tx-3",
    accountId: "acc-2",
    date: "13/11/2026",
    description: "TED Recebida - Assinatura Plano Enterprise",
    category: "Mensalidades SaaS",
    counterparty: "Logística Express S.A.",
    amount: 8900.0,
    type: "credit",
    reconciliationStatus: "pending",
    documentNumber: "TED-74521",
    hasAttachment: false,
  },
  {
    id: "tx-4",
    accountId: "acc-1",
    date: "12/11/2026",
    description: "Transferência Interna para BTG Tesouraria",
    category: "Transferência Entre Contas",
    counterparty: "BTG Pactual Empresas",
    amount: -25000.0,
    type: "transfer_out",
    reconciliationStatus: "reconciled",
    documentNumber: "TRF-90021",
    hasAttachment: true,
  },
  {
    id: "tx-5",
    accountId: "acc-3",
    date: "12/11/2026",
    description: "Aporte Transferência de Itaú Matriz",
    category: "Transferência Entre Contas",
    counterparty: "Itaú Unibanco Matriz",
    amount: 25000.0,
    type: "transfer_in",
    reconciliationStatus: "reconciled",
    documentNumber: "TRF-90021",
    hasAttachment: true,
  },
  {
    id: "tx-6",
    accountId: "acc-3",
    date: "11/11/2026",
    description: "Rendimento Automático CDB Liquidez Diária (104% CDI)",
    category: "Rendimento de Aplicação",
    counterparty: "BTG Pactual",
    amount: 1420.5,
    type: "credit",
    reconciliationStatus: "reconciled",
    documentNumber: "REND-CDI",
    hasAttachment: false,
  },
  {
    id: "tx-7",
    accountId: "acc-4",
    date: "10/11/2026",
    description: "Pagamento Folha Salarial - 1ª Parcela",
    category: "Folha de Pagamento",
    counterparty: "Colaboradores (Lote Bradesco)",
    amount: -28400.0,
    type: "debit",
    reconciliationStatus: "reconciled",
    documentNumber: "LOT-554411",
    hasAttachment: true,
  },
  {
    id: "tx-8",
    accountId: "acc-2",
    date: "10/11/2026",
    description: "Tarifa Mensal Cobrança de Boletos",
    category: "Despesas Bancárias",
    counterparty: "Nubank PJ",
    amount: -45.0,
    type: "debit",
    reconciliationStatus: "divergent",
    documentNumber: "TAR-0012",
    hasAttachment: false,
  },
]

