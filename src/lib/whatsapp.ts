import type {
  MessageStatus,
  MessageTemplate,
  WhatsAppConnectionStatus,
} from "@/types/domain";

/**
 * Vocabulário pt-BR do módulo WhatsApp — **fonte única** de rótulos de template
 * e de status (conexão e mensagem), chaves de query TanStack e tipos do contrato
 * de resposta da Edge Function `whatsapp` (ADR-04). Espelha o padrão de
 * `scheduling-status.ts`/`StatusBadge`: os textos pt-BR vivem aqui e os
 * componentes consomem daqui, sem duplicar literais. Nenhum segredo, nenhum
 * `tenant_id` (o isolamento é do banco via RLS).
 */

/** Rótulo pt-BR de cada template da régua de comunicação. */
const TEMPLATE_LABELS: Record<MessageTemplate, string> = {
  confirmacao: "Confirmação",
  lembrete_d1: "Lembrete (24h antes)",
  cobranca: "Cobrança",
  comprovante: "Comprovante",
  reagendar_retorno: "Retorno de reagendamento",
};

/**
 * Texto auxiliar (atributo `title`) do estado de um disparo sob a fila de
 * retentativa (Fatia 2, RNF04). Explica o estado sem expor PII nem o conteúdo
 * da resposta: `fila` = aguardando reenvio automático; `falha` = esgotou as
 * tentativas. `enviado`/`entregue` não têm nota extra (o rótulo do badge basta).
 */
const MESSAGE_STATUS_HINTS: Partial<Record<MessageStatus, string>> = {
  fila: "Aguardando reenvio automático",
  enviando: "Envio em andamento",
  falha: "Falhou após várias tentativas",
};

/** Rótulo pt-BR do estado da conexão de WhatsApp. */
const CONNECTION_STATUS_LABELS: Record<WhatsAppConnectionStatus, string> = {
  desconectado: "Desconectado",
  aguardando_qr: "Aguardando leitura do QR",
  conectado: "Conectado",
};

/** Rótulo pt-BR do estado de um disparo de mensagem. */
const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  fila: "Na fila",
  enviando: "Enviando…",
  enviado: "Enviado",
  entregue: "Entregue",
  falha: "Falha",
};

/** Rótulo pt-BR de um template (menu/histórico). */
export function getMessageTemplateLabel(template: MessageTemplate): string {
  return TEMPLATE_LABELS[template];
}

/** Rótulo pt-BR do estado da conexão (hub de conexão, badge). */
export function getWhatsAppConnectionStatusLabel(
  status: WhatsAppConnectionStatus,
): string {
  return CONNECTION_STATUS_LABELS[status];
}

/** Rótulo pt-BR do estado de um disparo (histórico, badge). */
export function getMessageStatusLabel(status: MessageStatus): string {
  return MESSAGE_STATUS_LABELS[status];
}

/**
 * Nota pt-BR (atributo `title`) do estado da fila de retentativa, ou `undefined`
 * quando o estado não precisa de explicação extra. Sem PII, sem conteúdo cru.
 */
export function getMessageStatusHint(
  status: MessageStatus,
): string | undefined {
  return MESSAGE_STATUS_HINTS[status];
}

/** Chave de query da instância de WhatsApp do tenant (ADR-06). */
export const WHATSAPP_INSTANCE_KEY = ["whatsapp-instance"] as const;

/** Chave de query do histórico de mensagens (ADR-06). */
export const MESSAGES_KEY = ["messages"] as const;

/** Chave de query dos templates editáveis do tenant (ADR-05/06). */
export const MESSAGE_TEMPLATES_KEY = ["message-templates"] as const;

/**
 * DTOs do contrato de resposta da Edge Function `whatsapp` (ADR-04 é a DONA do
 * contrato de fio). Espelham `supabase/functions/whatsapp/schemas.ts`: se o
 * contrato mudar lá, atualizar aqui e os schemas zod do frontend (ADR-06). O
 * payload de `send` usa camelCase; qualquer `tenant_id` enviado é ignorado pelo
 * servidor.
 */

/** Resultado de negócio do envio — cada valor é traduzido pelo mapa de erro. */
export type SendOutcome =
  | "sent"
  | "duplicate"
  | "opt_out"
  | "not_connected"
  | "send_failed";

/** Payload de `pair` — tenant derivado do JWT no servidor. */
export interface PairRequest {
  action: "pair";
}

/** Payload de `check` — tenant derivado do JWT no servidor (ADR-17). */
export interface CheckRequest {
  action: "check";
}

/** Payload de `send` (camelCase, alinhado ao consumidor). */
export interface SendRequest {
  action: "send";
  template: MessageTemplate;
  customerId: string;
  appointmentId?: string;
}

/** Resposta de `pair`. QR não é persistido; vem só nesta resposta. */
export interface PairResponse {
  connection_status: WhatsAppConnectionStatus;
  qr_code_base64?: string;
  last_connected_at?: string | null;
}

/**
 * Resposta de `check` (ADR-17) — o estado persistido após o servidor reconciliar
 * com a Evolution. Sem QR: a reconciliação não re-emite código, só informa o
 * estado canônico. A UI (ADR-19) a valida por zod e trata como best-effort.
 */
export interface CheckResponse {
  connection_status: WhatsAppConnectionStatus;
  last_connected_at?: string | null;
}

/** Resposta de `send` — a UI lê `outcome` para decidir a mensagem. */
export interface SendResponse {
  outcome: SendOutcome;
  message_id: string | null;
  status: MessageStatus;
  provider_message_id?: string | null;
}
