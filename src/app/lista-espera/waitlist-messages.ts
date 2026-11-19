/**
 * Catálogo local tipado do domínio de waitlist (Fase 4, ADR-13 / RF-07..RF-11).
 *
 * Segue o padrão aceito do repo (catálogo tipado por domínio, ex.:
 * `payments-messages.ts`): nenhum literal de UI fora daqui. Componentes de
 * apresentação recebem `messages` por prop — nenhum importa este módulo
 * diretamente, exceto as shells que o repassam.
 */

export const waitlistMessages = {
  page: {
    title: "Lista de espera",
    description:
      "Entradas por serviço e profissional, ordenadas por prioridade e validade.",
    newEntry: "Nova entrada",
    filtersTitle: "Filtros",
    searchLabel: "Buscar cliente",
    searchPlaceholder: "Nome do cliente…",
    statusLabel: "Status",
    allStatuses: "Todos",
    serviceLabel: "Serviço",
    allServices: "Todos",
    professionalLabel: "Profissional",
    allProfessionals: "Todos",
    loading: "Carregando lista de espera…",
    emptyTitle: "Nenhuma entrada na lista de espera",
    emptyDescription:
      "Quando um horário estiver ocupado, use “Entrar na lista de espera” para registrar o cliente aqui.",
    errorTitle: "Não foi possível carregar a lista de espera",
    errorDescription: "Verifique sua conexão e tente novamente.",
    retry: "Tentar novamente",
    tableCaption:
      "Lista de espera: cliente, serviço, profissional, prioridade, validade e ações.",
    colCustomer: "Cliente",
    colService: "Serviço",
    colProfessional: "Profissional",
    colPriority: "Prioridade",
    colValidUntil: "Válido até",
    colStatus: "Status",
    colActions: "Ações",
    offerNow: "Ofertar agora",
    offerNowAria: "Ofertar vaga agora para {cliente}",
    markAttended: "Marcar atendida",
    markAttendedAria: "Marcar entrada de {cliente} como atendida",
    markExpired: "Marcar expirada",
    markExpiredAria: "Marcar oferta de {cliente} como expirada",
    remove: "Remover",
    removeAria: "Remover entrada de {cliente}",
    reorderUp: "Subir na fila",
    reorderUpAria: "Subir {cliente} na fila",
    reorderDown: "Descer na fila",
    reorderDownAria: "Descer {cliente} na fila",
    viewOffer: "Ver oferta",
    viewOfferAria: "Ver oferta para {cliente}",
    noValidity: "Sem validade",
  },
  priority: {
    alta: "Alta",
    normal: "Normal",
    baixa: "Baixa",
  },
  status: {
    aguardando: "Aguardando",
    ofertado: "Oferta enviada",
    confirmado: "Confirmada",
    recusado: "Recusada",
    expirado: "Expirada",
    atendido: "Atendida",
    cancelado: "Removida",
  },
  enroll: {
    title: "Entrar na lista de espera",
    description:
      "O horário está ocupado. Registre o cliente para ser avisado quando uma vaga abrir.",
    customerLabel: "Cliente",
    customerPlaceholder: "Selecione o cliente",
    serviceLabel: "Serviço",
    servicePlaceholder: "Selecione o serviço",
    professionalLabel: "Profissional",
    professionalPlaceholder: "Selecione o profissional",
    anyProfessional: "Qualquer profissional",
    professionalHint: "Vazio aceita vaga com qualquer profissional.",
    fromLabel: "Período desejado (início)",
    toLabel: "Período desejado (fim)",
    priorityLabel: "Prioridade",
    validityLabel: "Válido até",
    validityHint: "Após essa data a entrada expira automaticamente.",
    submit: "Entrar na lista de espera",
    submitting: "Registrando…",
    cancel: "Cancelar",
    success: "Cliente entrou na lista de espera.",
    duplicate: "Este cliente já está na lista para este período.",
    error: "Não foi possível registrar. Tente de novo.",
    required: "Campo obrigatório.",
    invalidPeriod: "O fim do período precisa ser depois do início.",
  },
  offer: {
    title: "Vaga disponível!",
    description: "Uma vaga abriu para {cliente}. Confirme antes do tempo acabar.",
    slotLabel: "Horário ofertado",
    countdownLabel: "Tempo para confirmar",
    countdownAria: "Tempo restante para confirmar: {restante}",
    confirm: "Confirmar",
    confirming: "Confirmando…",
    decline: "Recusar",
    declining: "Recusando…",
    confirmed: "Agendamento confirmado.",
    declined: "Oferta recusada. A vaga passa para o próximo da fila.",
    expiredTitle: "Oferta expirada",
    expiredDescription: "O tempo acabou. A vaga passou para o próximo da fila.",
    close: "Fechar",
    error: "Não foi possível responder à oferta. Tente de novo.",
  },
  manage: {
    attendedSuccess: "Entrada marcada como atendida.",
    expiredSuccess: "Oferta marcada como expirada. A vaga passa ao próximo da fila.",
    removedSuccess: "Entrada removida.",
    reordered: "Posição atualizada.",
    error: "Não foi possível atualizar. Tente de novo.",
  },
  gating: {
    resource: "Lista de espera",
    action: "Gerenciar lista de espera",
  },
  cta: {
    label: "Lista de espera",
    enrollLabel: "Entrar na lista de espera",
    viewLabel: "Ver lista de espera",
    backToAgenda: "Voltar à agenda",
  },
} as const;

type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : Mutable<T[K]>;
};

export type WaitlistMessages = Mutable<typeof waitlistMessages>;

export function formatWaitlistMessage(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return whole;
    const value = values[key];
    return value === undefined || value === null ? whole : String(value);
  });
}
