export type SettingsSectionId =
  | "general"
  | "appearance"
  | "financial"
  | "pdv"
  | "payments"
  | "team"
  | "security"
  | "notifications"
  | "integrations"
  | "billing"
  | "advanced"

export type SettingsGroupId = "workspace" | "operation" | "access" | "platform"

export interface SettingsNavItem {
  id: SettingsSectionId
  group: SettingsGroupId
  label: string
  description: string
  /** Sinônimos usados pela busca global (Ctrl/⌘ + K) */
  keywords: string[]
}

export const SETTINGS_GROUPS: Record<SettingsGroupId, string> = {
  workspace: "Workspace",
  operation: "Operação",
  access: "Acesso & Segurança",
  platform: "Plataforma",
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: "general", group: "workspace", label: "Geral", description: "Dados da empresa, fuso horário e formatos regionais", keywords: ["empresa", "cnpj", "razão social", "fuso", "timezone", "idioma", "moeda", "data", "logo"] },
  { id: "appearance", group: "workspace", label: "Aparência", description: "Tema, densidade e preferências de interface", keywords: ["tema", "escuro", "claro", "dark", "densidade", "compacto", "cor"] },
  { id: "financial", group: "operation", label: "Financeiro & Fiscal", description: "Regime tributário, conciliação e fechamento", keywords: ["imposto", "regime", "simples", "conciliação", "fechamento", "categoria", "juros", "multa", "vencimento"] },
  { id: "pdv", group: "operation", label: "PDV & NFC-e", description: "Terminal, impressora, série fiscal e atalhos", keywords: ["caixa", "pdv", "nfc-e", "nota fiscal", "impressora", "série", "csc", "troco", "sangria"] },
  { id: "payments", group: "operation", label: "Pagamentos", description: "Pix, boleto, cartão e taxas", keywords: ["pix", "chave", "boleto", "cartão", "taxa", "adquirente", "parcelamento"] },
  { id: "team", group: "access", label: "Equipe & Permissões", description: "Perfis de acesso e controle por módulo", keywords: ["usuário", "perfil", "role", "permissão", "acesso", "convite", "admin"] },
  { id: "security", group: "access", label: "Segurança", description: "2FA, sessões, senha e restrição de IP", keywords: ["2fa", "mfa", "senha", "sessão", "ip", "auditoria", "login", "sso"] },
  { id: "notifications", group: "platform", label: "Notificações", description: "Canais e eventos que geram alertas", keywords: ["email", "e-mail", "whatsapp", "push", "alerta", "resumo", "digest"] },
  { id: "integrations", group: "platform", label: "Integrações & API", description: "Open Finance, chaves de API e webhooks", keywords: ["api", "token", "webhook", "open finance", "chave", "integração", "ofx"] },
  { id: "billing", group: "platform", label: "Plano & Faturamento", description: "Assinatura, uso e dados de cobrança", keywords: ["plano", "assinatura", "fatura", "cobrança", "upgrade", "cnpj de cobrança"] },
  { id: "advanced", group: "platform", label: "Avançado", description: "Exportação de dados e zona de perigo", keywords: ["exportar", "excluir", "resetar", "perigo", "backup", "lgpd", "apagar"] },
]

export type RoleId = "owner" | "admin" | "finance" | "operator" | "viewer"
export type ModuleId = "transactions" | "cards" | "accounts" | "pdv" | "settings"
export type PermissionLevel = "none" | "read" | "write"

export interface NotificationChannels {
  email: boolean
  push: boolean
  whatsapp: boolean
}

export interface SettingsValues {
  // Geral
  companyName: string
  tradeName: string
  cnpj: string
  email: string
  phone: string
  timezone: string
  locale: string
  currency: string
  dateFormat: string
  // Aparência
  theme: "system" | "light" | "dark"
  density: "comfortable" | "compact"
  reduceMotion: boolean
  // Financeiro
  taxRegime: string
  fiscalYearStart: string
  autoReconcile: boolean
  lateFeePercent: string
  interestPercentMonth: string
  closingDay: string
  blockPostingClosedPeriod: boolean
  // PDV
  terminalName: string
  nfceSeries: string
  nfceEnvironment: "homologation" | "production"
  printerModel: string
  printerWidth: "58" | "80"
  autoPrintReceipt: boolean
  requireCustomerDocument: boolean
  maxDiscountPercent: string
  // Pagamentos
  pixKeyType: string
  pixKey: string
  acceptCredit: boolean
  acceptDebit: boolean
  acceptBoleto: boolean
  maxInstallments: string
  // Equipe
  permissions: Record<RoleId, Record<ModuleId, PermissionLevel>>
  // Segurança
  require2fa: boolean
  sessionTimeoutMinutes: string
  passwordMinLength: string
  ipAllowlistEnabled: boolean
  ipAllowlist: string
  // Notificações
  notifications: Record<string, NotificationChannels>
  weeklyDigest: boolean
  // Integrações
  openFinanceEnabled: boolean
  webhookUrl: string
  webhookEvents: Record<string, boolean>
}

export const NOTIFICATION_EVENTS: { id: string; label: string; hint: string }[] = [
  { id: "invoice_due", label: "Fatura de cartão a vencer", hint: "3 dias antes do vencimento" },
  { id: "low_balance", label: "Saldo baixo em conta", hint: "Abaixo do limite mínimo configurado" },
  { id: "reconciliation", label: "Divergência de conciliação", hint: "Lançamentos sem correspondência" },
  { id: "cash_close", label: "Fechamento de caixa (PDV)", hint: "Diferença entre contado e esperado" },
  { id: "security", label: "Eventos de segurança", hint: "Novo login, troca de senha, 2FA" },
]

export const ROLE_LABELS: Record<RoleId, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  finance: "Financeiro",
  operator: "Operador de caixa",
  viewer: "Somente leitura",
}

export const MODULE_LABELS: Record<ModuleId, string> = {
  transactions: "Transações",
  cards: "Cartões",
  accounts: "Contas",
  pdv: "PDV",
  settings: "Configurações",
}

export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  "payment.confirmed": "Pagamento confirmado",
  "invoice.paid": "Fatura paga",
  "sale.completed": "Venda concluída (PDV)",
  "account.synced": "Conta sincronizada",
}

export const DEFAULT_SETTINGS: SettingsValues = {
  companyName: "Atlas Comércio e Serviços Ltda",
  tradeName: "Atlas Workspace",
  cnpj: "12.345.678/0001-90",
  email: "financeiro@atlas.com.br",
  phone: "(11) 3456-7890",
  timezone: "America/Sao_Paulo",
  locale: "pt-BR",
  currency: "BRL",
  dateFormat: "dd/MM/yyyy",
  theme: "system",
  density: "comfortable",
  reduceMotion: false,
  taxRegime: "simples",
  fiscalYearStart: "01",
  autoReconcile: true,
  lateFeePercent: "2,00",
  interestPercentMonth: "1,00",
  closingDay: "5",
  blockPostingClosedPeriod: true,
  terminalName: "Caixa 01 • Loja Matriz",
  nfceSeries: "001",
  nfceEnvironment: "homologation",
  printerModel: "Epson TM-T20X",
  printerWidth: "80",
  autoPrintReceipt: true,
  requireCustomerDocument: false,
  maxDiscountPercent: "10",
  pixKeyType: "cnpj",
  pixKey: "12.345.678/0001-90",
  acceptCredit: true,
  acceptDebit: true,
  acceptBoleto: true,
  maxInstallments: "12",
  permissions: {
    owner: { transactions: "write", cards: "write", accounts: "write", pdv: "write", settings: "write" },
    admin: { transactions: "write", cards: "write", accounts: "write", pdv: "write", settings: "write" },
    finance: { transactions: "write", cards: "write", accounts: "write", pdv: "read", settings: "none" },
    operator: { transactions: "none", cards: "none", accounts: "none", pdv: "write", settings: "none" },
    viewer: { transactions: "read", cards: "read", accounts: "read", pdv: "read", settings: "none" },
  },
  require2fa: true,
  sessionTimeoutMinutes: "60",
  passwordMinLength: "10",
  ipAllowlistEnabled: false,
  ipAllowlist: "",
  notifications: {
    invoice_due: { email: true, push: true, whatsapp: false },
    low_balance: { email: true, push: true, whatsapp: true },
    reconciliation: { email: true, push: false, whatsapp: false },
    cash_close: { email: false, push: true, whatsapp: false },
    security: { email: true, push: true, whatsapp: false },
  },
  weeklyDigest: true,
  openFinanceEnabled: true,
  webhookUrl: "https://api.atlas.com.br/hooks/atlas",
  webhookEvents: {
    "payment.confirmed": true,
    "invoice.paid": true,
    "sale.completed": false,
    "account.synced": false,
  },
}

