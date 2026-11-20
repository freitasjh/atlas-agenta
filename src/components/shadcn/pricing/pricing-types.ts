export type BillingPeriod = "monthly" | "annually"

export interface PricingFeature {
  text: string
  included: boolean
  highlight?: boolean
}

export interface PricingPlan {
  id: string
  name: string
  description: string
  badge?: string
  isPopular?: boolean
  priceMonthly: number
  priceAnnually: number
  features: PricingFeature[]
  ctaText: string
  ctaVariant?: "default" | "outline" | "secondary"
  limitLabel?: string
}

export interface ComparisonCategory {
  category: string
  features: {
    name: string
    tooltip?: string
    starter: string | boolean
    professional: string | boolean
    enterprise: string | boolean
  }[]
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Ideal para profissionais autônomos, consultórios individuais e pequenos escritórios.",
    priceMonthly: 89,
    priceAnnually: 71, // 20% off
    limitLabel: "Até 2 profissionais",
    ctaText: "Começar Grátis por 14 Dias",
    ctaVariant: "outline",
    features: [
      { text: "Até 2 profissionais na grade", included: true },
      { text: "Até 500 agendamentos/mês", included: true },
      { text: "Quadro Kanban com até 3 colunas", included: true },
      { text: "Régua horária diária e semanal", included: true },
      { text: "Histórico de atendimentos (30 dias)", included: true },
      { text: "Notificações por WhatsApp", included: false },
      { text: "Multi-salas e unidades", included: false },
      { text: "API e Webhooks", included: false },
    ],
  },
  {
    id: "professional",
    name: "Professional",
    description: "Perfeito para clínicas em expansão, centros de saúde e equipes multidisciplinares.",
    badge: "Mais Popular",
    isPopular: true,
    priceMonthly: 199,
    priceAnnually: 159, // 20% off
    limitLabel: "Até 10 profissionais",
    ctaText: "Assinar Professional",
    ctaVariant: "default",
    features: [
      { text: "Até 10 profissionais na grade", included: true, highlight: true },
      { text: "Agendamentos ilimitados", included: true, highlight: true },
      { text: "Quadro Kanban completo (Linear style)", included: true },
      { text: "Agenda com indicador em tempo real e bloqueios", included: true },
      { text: "Notificações automáticas por WhatsApp/SMS", included: true },
      { text: "Faturamento e controle financeiro integrado", included: true },
      { text: "Histórico completo e prontuários ilimitados", included: true },
      { text: "Exportação de relatórios em Excel/PDF", included: true },
      { text: "Suporte prioritário via chat e e-mail", included: true },
      { text: "Gerente de contas dedicado", included: false },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Solução sob medida para hospitais, policlínicas, franquias e redes com alta demanda.",
    badge: "Corporativo",
    priceMonthly: 489,
    priceAnnually: 390, // 20% off
    limitLabel: "Profissionais ilimitados",
    ctaText: "Falar com Especialista",
    ctaVariant: "outline",
    features: [
      { text: "Profissionais e salas ilimitados", included: true },
      { text: "Gestão multi-unidades e filiais", included: true, highlight: true },
      { text: "Conciliação bancária automática com adquirentes", included: true },
      { text: "API REST completa e Webhooks em tempo real", included: true },
      { text: "Single Sign-On (SSO / SAML) e auditoria LGPD", included: true },
      { text: "Backup diário com redundância geográfica", included: true },
      { text: "SLA de disponibilidade contratual de 99,9%", included: true },
      { text: "Treinamento presencial/remoto da equipe", included: true },
      { text: "Gerente de sucesso dedicado 24/7", included: true },
    ],
  },
]

export const COMPARISON_TABLE: ComparisonCategory[] = [
  {
    category: "Agendamento & Calendário",
    features: [
      {
        name: "Profissionais na Grade",
        starter: "Até 2",
        professional: "Até 10",
        enterprise: "Ilimitados",
      },
      {
        name: "Visão Dia / Semana / Lista",
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        name: "Now Indicator (Hora Atual ao Vivo)",
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        name: "Bloqueio de Almoço & Ausências",
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        name: "Lembretes Automáticos WhatsApp",
        starter: false,
        professional: true,
        enterprise: true,
      },
      {
        name: "Multi-Unidades / Filiais",
        starter: false,
        professional: false,
        enterprise: true,
      },
    ],
  },
  {
    category: "Gestão de Tarefas (Kanban)",
    features: [
      {
        name: "Quadro Drag-and-Drop",
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        name: "Filtros de Prioridade e Busca",
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        name: "Subtarefas e Progresso",
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        name: "Automação de Movimentação",
        starter: false,
        professional: true,
        enterprise: true,
      },
    ],
  },
  {
    category: "Financeiro & Governança",
    features: [
      {
        name: "Controle de Faturamento do Dia",
        starter: true,
        professional: true,
        enterprise: true,
      },
      {
        name: "Exportação Contábil (CSV/XLSX)",
        starter: false,
        professional: true,
        enterprise: true,
      },
      {
        name: "Conciliação Automática Bacen/DI",
        starter: false,
        professional: false,
        enterprise: true,
      },
      {
        name: "Auditoria e Logs de Acesso LGPD",
        starter: false,
        professional: "Básico",
        enterprise: "Avançado + SIEM",
      },
      {
        name: "SSO Corporativo (Okta, Azure, Google)",
        starter: false,
        professional: false,
        enterprise: true,
      },
    ],
  },
  {
    category: "Suporte & SLAs",
    features: [
      {
        name: "Canal de Atendimento",
        starter: "E-mail",
        professional: "Chat & E-mail prioritário",
        enterprise: "Telefone & Gerente dedicado",
      },
      {
        name: "Tempo de Resposta Garantido",
        starter: "48h úteis",
        professional: "4h úteis",
        enterprise: "30 minutos (24/7)",
      },
      {
        name: "SLA de Disponibilidade",
        starter: "99,0%",
        professional: "99,5%",
        enterprise: "99,9% contratual",
      },
    ],
  },
]

