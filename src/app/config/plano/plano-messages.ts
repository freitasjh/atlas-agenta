/**
 * Vocabulário pt-BR da PlanoPage evoluída (Fase 4, ADR-18 G, RF-35..RF-38).
 * Textos de estados de assinatura, uso vs quota, fatura, histórico e checkout
 * self-service. Espelha o padrão `fidelidade-messages`/`campanhas-messages`:
 * literais fora de componentes, sem PII, sem segredo.
 */
export const planoMessages = {
  page: {
    title: "Plano",
    description: "Seu plano atual e os recursos liberados.",
    loading: "Carregando plano",
    retry: "Tentar novamente",
  },
  status: {
    bloqueadoTitle: "Conta bloqueada: regularize o pagamento",
    bloqueadoDescription:
      "A cobrança está em aberto e a operação está pausada. Quite a fatura para retomar agenda, PDV e disparos.",
    bloqueadoAction: "Ver fatura em aberto",
    canceladoTitle: "Assinatura cancelada",
    canceladoDescription:
      "Sua assinatura foi cancelada e os disparos automáticos estão suspensos. Escolha um plano para reativar.",
    canceladoAction: "Reativar assinatura",
    pendenteTitle: "Pagamento pendente",
    pendenteDescription:
      "Identificamos uma cobrança aguardando confirmação do gateway. Assim que compensar, o plano atualiza sozinho.",
    pendenteAction: "Verificar status",
    trialTitle: "Você está no período de teste",
    trialDescription:
      "Aproveite todos os recursos liberados. Assine um plano para não interromper a operação.",
  },
  current: {
    title: "Plano atual",
    noPlan: "Nenhum plano vinculado",
    noPlanDescription:
      "Não encontramos um plano ativo para este tenant. Fale com o responsável pela conta.",
    perMonth: "/mês",
    free: "Grátis",
    professionalsUsed: "Profissionais em uso",
    appointmentsQuota: "Agendamentos no mês",
    unlimited: "Ilimitado",
    notMeasured: "—",
    usagePendingHint:
      "A contagem mensal de agendamentos chega com as métricas de plano (backend). Os limites acima já valem.",
  },
  invoice: {
    title: "Fatura atual",
    historyTitle: "Histórico de faturas",
    emptyTitle: "Nenhuma fatura encontrada",
    emptyDescription:
      "Ainda não há cobranças de assinatura para este tenant.",
    paid: "Paga",
    pending: "Pendente",
    expired: "Expirada",
    canceled: "Cancelada",
    dueIn: "Vence em",
    paidAt: "Paga em",
    errorTitle: "Não foi possível carregar as faturas",
    errorDescription: "Verifique sua conexão e tente novamente.",
  },
  checkout: {
    title: "Trocar de plano",
    description:
      "Upgrade tem efeito imediato após a confirmação do pagamento. Downgrade passa a valer no fim do ciclo atual.",
    gatedTitle: "Checkout self-service não incluído no plano atual",
    gatedDescription:
      "Seu plano mostra as opções abaixo, mas a troca automática está bloqueada. Fale com o responsável pela conta ou veja outros planos.",
    choosePlan: "Escolher plano",
    currentPlan: "Plano atual",
    confirmTitle: "Confirmar troca de plano",
    confirmUpgrade:
      "Você vai para o plano {plano}. A cobrança é imediata e os novos recursos liberam após a confirmação do pagamento.",
    confirmDowngrade:
      "Você vai para o plano {plano}. A troca passa a valer no fim do ciclo atual, sem cobrança agora.",
    confirmAction: "Confirmar e gerar PIX",
    cancelAction: "Voltar",
    starting: "Gerando cobrança…",
    pendingTitle: "Aguardando pagamento",
    pendingDescription:
      "Abra o PIX gerado e conclua o pagamento. O plano atualiza sozinho após a confirmação do gateway.",
    downgradeScheduled: "Downgrade agendado para {data}.",
    downgradeTitle: "Downgrade agendado",
    downgradeDescription:
      "Sua troca de plano foi registrada e passa a valer no fim do ciclo atual.",
    successTitle: "Pagamento confirmado",
    successDescription:
      "O plano foi atualizado. Se a lista abaixo ainda mostra o plano antigo, aguarde alguns segundos e verifique o status.",
    errorTitle: "Não foi possível gerar a cobrança",
    errorDescription: "Tente novamente. Se persistir, fale com o suporte.",
    retryCheckout: "Tentar novamente",
    noOptions: "Nenhuma outra opção de plano disponível no momento.",
  },
  resources: {
    title: "Recursos do plano",
    description: "Recursos de estética liberados no plano atual.",
  },
} as const;
