import {
  getMessageStatusHint,
  getMessageStatusLabel,
  getWhatsAppConnectionStatusLabel,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import type { MessageStatus, WhatsAppConnectionStatus } from "@/types/domain";

/**
 * Badge irmão do `StatusBadge` (não incha o existente, que já é consumido por
 * Agenda/Clientes/assinatura). Mesma casca visual e **reusa os tokens de status
 * já calibrados AA** — nenhum token novo. Rótulo textual pt-BR além da cor
 * (cor nunca é o único sinal; a11y). Os rótulos vêm de `src/lib/whatsapp.ts`
 * (fonte única), não duplicados aqui.
 *
 * Mapa de tokens (ADR-05):
 *  - conexão: conectado→confirmado, aguardando_qr→pendente, desconectado→cancelado.
 *  - mensagem: enviado/entregue→confirmado, fila→pendente, falha→cancelado.
 */
const CONNECTION_CLASSNAME: Record<WhatsAppConnectionStatus, string> = {
  conectado: "bg-status-confirmado text-status-confirmado-foreground",
  aguardando_qr: "bg-status-pendente text-status-pendente-foreground",
  desconectado: "bg-status-cancelado text-status-cancelado-foreground",
};

const MESSAGE_CLASSNAME: Record<MessageStatus, string> = {
  enviado: "bg-status-confirmado text-status-confirmado-foreground",
  entregue: "bg-status-confirmado text-status-confirmado-foreground",
  fila: "bg-status-pendente text-status-pendente-foreground",
  falha: "bg-status-cancelado text-status-cancelado-foreground",
};

interface ConnectionBadgeProps {
  connectionStatus: WhatsAppConnectionStatus;
  className?: string;
}

interface MessageBadgeProps {
  messageStatus: MessageStatus;
  className?: string;
}

type WhatsAppStatusBadgeProps = ConnectionBadgeProps | MessageBadgeProps;

function isConnection(
  props: WhatsAppStatusBadgeProps,
): props is ConnectionBadgeProps {
  return "connectionStatus" in props;
}

/**
 * Badge de status do módulo WhatsApp. Passe `connectionStatus` para o estado da
 * conexão ou `messageStatus` para o estado de um disparo.
 */
export function WhatsAppStatusBadge(props: WhatsAppStatusBadgeProps) {
  const label = isConnection(props)
    ? getWhatsAppConnectionStatusLabel(props.connectionStatus)
    : getMessageStatusLabel(props.messageStatus);

  const className = isConnection(props)
    ? CONNECTION_CLASSNAME[props.connectionStatus]
    : MESSAGE_CLASSNAME[props.messageStatus];

  // Estado de mensagem sob retentativa/falha ganha uma nota pt-BR no `title`
  // (ex.: "Aguardando reenvio automático"), sem PII nem conteúdo cru.
  const title = isConnection(props)
    ? undefined
    : getMessageStatusHint(props.messageStatus);

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
        props.className,
      )}
    >
      {label}
    </span>
  );
}
