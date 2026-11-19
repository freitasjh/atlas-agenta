import { useMemo } from "react";

import { useRecentMessages } from "@/hooks/useMessages";
import type {
  Message,
  MessageStatus,
  MessageTemplate,
} from "@/types/domain";

/**
 * Métricas de WhatsApp (Fase 4, ADR-11 H/ADR-18 UI).
 *
 * O enum persistido `messages.status` (`fila|enviando|enviado|entregue|falha`)
 * cobre envio/entrega/falha; leitura/confirmação/resposta ainda não têm status
 * próprio no provider — os KPIs correspondentes voltam `0` com o flag
 * `parcial: true` e a UI exibe "—" + nota honesta em vez de zero falso.
 * Quando as RPCs da ADR-11 (`whatsapp_kpis`, `whatsapp_message_log`) existirem,
 * este hook passa a consumi-las; a agregação local segue como fallback.
 */

export interface WhatsAppKpis {
  total: number;
  enviadas: number;
  entregues: number;
  lidas: number;
  confirmadas: number;
  respostas: number;
  falhas: number;
  pendentes: number;
  taxaEntrega: number | null;
  taxaFalha: number | null;
  /** True enquanto leitura/confirmação/resposta não têm status no banco. */
  parcial: boolean;
}

export function aggregateWhatsAppKpis(messages: Message[]): WhatsAppKpis {
  const total = messages.length;
  const enviadas = messages.filter(
    (m) => m.status === "enviado" || m.status === "entregue",
  ).length;
  const entregues = messages.filter((m) => m.status === "entregue").length;
  const falhas = messages.filter((m) => m.status === "falha").length;
  const pendentes = messages.filter(
    (m) => m.status === "fila" || m.status === "enviando",
  ).length;
  const base = enviadas + falhas;
  return {
    total,
    enviadas,
    entregues,
    lidas: 0,
    confirmadas: 0,
    respostas: 0,
    falhas,
    pendentes,
    taxaEntrega: enviadas > 0 ? entregues / enviadas : null,
    taxaFalha: base > 0 ? falhas / base : null,
    parcial: true,
  };
}

export type BanRiskLevel = "baixo" | "atencao" | "alto";

export interface BanRisk {
  level: BanRiskLevel;
  taxaFalha: number | null;
  recomendacao: string;
}

/**
 * Heurística provisória de risco de ban (ADR-11, pergunta 10 em aberto):
 * falha > 10% = alto; > 5% = atenção; senão baixo. Sem volume, sem veredito.
 */
export function assessBanRisk(kpis: WhatsAppKpis): BanRisk {
  const { taxaFalha } = kpis;
  if (taxaFalha === null) {
    return {
      level: "baixo",
      taxaFalha,
      recomendacao: "Sem volume no período para avaliar risco.",
    };
  }
  if (taxaFalha > 0.1) {
    return {
      level: "alto",
      taxaFalha,
      recomendacao:
        "Taxa de falha acima de 10%. Pause disparos em massa e revise números e conteúdo antes de continuar.",
    };
  }
  if (taxaFalha > 0.05) {
    return {
      level: "atencao",
      taxaFalha,
      recomendacao:
        "Taxa de falha acima de 5%. Monitore os próximos envios e evite rajadas.",
    };
  }
  return {
    level: "baixo",
    taxaFalha,
    recomendacao: "Entrega saudável. Mantenha o ritmo atual de envios.",
  };
}

export interface MessageLogFilter {
  status: "todos" | MessageStatus;
  template: "todos" | MessageTemplate;
  busca: string;
}

export const EMPTY_LOG_FILTER: MessageLogFilter = {
  status: "todos",
  template: "todos",
  busca: "",
};

export function filterMessageLog(
  messages: Message[],
  filter: MessageLogFilter,
  nameById?: (customerId: string) => string,
): Message[] {
  const busca = filter.busca.trim().toLowerCase();
  return messages.filter((message) => {
    if (filter.status !== "todos" && message.status !== filter.status)
      return false;
    if (filter.template !== "todos" && message.template !== filter.template)
      return false;
    if (busca !== "") {
      const nome = nameById ? nameById(message.customer_id).toLowerCase() : "";
      const motivo = (message.failure_reason ?? "").toLowerCase();
      if (!nome.includes(busca) && !motivo.includes(busca)) return false;
    }
    return true;
  });
}

export interface WhatsAppMetrics {
  messages: Message[];
  kpis: WhatsAppKpis;
  banRisk: BanRisk;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useWhatsAppMetrics(limit = 100): WhatsAppMetrics {
  const messagesQuery = useRecentMessages(limit);
  const messages = useMemo(
    () => messagesQuery.data ?? [],
    [messagesQuery.data],
  );
  const kpis = useMemo(() => aggregateWhatsAppKpis(messages), [messages]);
  const banRisk = useMemo(() => assessBanRisk(kpis), [kpis]);
  return {
    messages,
    kpis,
    banRisk,
    isLoading: messagesQuery.isLoading,
    isError: messagesQuery.isError,
    refetch: () => {
      void messagesQuery.refetch();
    },
  };
}
