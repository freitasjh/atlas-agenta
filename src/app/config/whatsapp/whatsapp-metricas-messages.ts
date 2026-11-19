/**
 * Vocabulário pt-BR da aba Métricas do WhatsApp (Fase 4, ADR-18 H, RF-39..RF-41).
 * KPIs, risco de ban, log filtrável e negação de acesso. Sem PII, sem segredo.
 */
export const whatsappMetricasMessages = {
  tabs: {
    conexao: "Conexão",
    mensagens: "Mensagens",
    metricas: "Métricas",
    label: "Seções do WhatsApp",
  },
  kpis: {
    title: "Desempenho do canal",
    description: "Envios do tenant no período carregado.",
    enviadas: "Enviadas",
    entregues: "Entregues",
    lidas: "Lidas",
    confirmadas: "Confirmadas",
    respostas: "Respostas",
    falhas: "Falhas",
    pendentes: "Na fila",
    taxaEntrega: "Taxa de entrega",
    taxaFalha: "Taxa de falha",
    unavailable: "—",
    partialNote:
      "Leitura, confirmação e resposta ainda não têm status no provedor; chegam com as métricas completas (backend).",
    loading: "Carregando métricas",
    errorTitle: "Não foi possível carregar as métricas",
    errorDescription: "Verifique sua conexão e tente novamente.",
    retry: "Tentar novamente",
    emptyTitle: "Sem envios no período",
    emptyDescription:
      "Quando houver disparos de WhatsApp, os indicadores aparecem aqui.",
  },
  ban: {
    title: "Risco de ban",
    baixo: "Baixo",
    atencao: "Atenção",
    alto: "Alto",
  },
  log: {
    title: "Log de envios",
    description: "Filtre por status, mensagem e busca.",
    statusLabel: "Status",
    templateLabel: "Mensagem",
    searchLabel: "Buscar",
    searchPlaceholder: "Nome do cliente ou motivo da falha",
    all: "Todos",
    allTemplates: "Todas",
    emptyTitle: "Nada encontrado",
    emptyDescription: "Ajuste os filtros para ver outros envios.",
    colCliente: "Cliente",
    colMensagem: "Mensagem",
    colStatus: "Status",
    colQuando: "Quando",
    caption: "Envios mais recentes primeiro.",
  },
  denied: {
    title: "Métricas restritas a administradores",
    description:
      "Seu perfil vê conexão e mensagens, mas os indicadores do canal são exclusivos do administrador da conta.",
  },
} as const;
