import { useMemo } from "react";

import { WhatsAppStatusBadge } from "@/components/WhatsAppStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCustomers } from "@/hooks/useCustomers";
import { useRecentMessages } from "@/hooks/useMessages";
import { formatDateInTenantTz, formatTimeInTenantTz } from "@/lib/datetime";
import { getMessageTemplateLabel } from "@/lib/whatsapp";
import type { Message } from "@/types/domain";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * Histórico recente de disparos de WhatsApp do tenant. Lê `messages` sob RLS com
 * projeção **sem PII** (ADR-06: nunca telefone/corpo). O nome do cliente vem do
 * mapa de `useCustomers` (leitura sob RLS); o telefone nunca é exibido aqui.
 * Desktop: tabela; mobile: cards — sem overflow horizontal em ~375px.
 */
export function RecentMessagesList() {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? DEFAULT_TIMEZONE;

  const messagesQuery = useRecentMessages();
  const customersQuery = useCustomers();

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customersQuery.data ?? []) {
      map.set(customer.id, customer.name);
    }
    return map;
  }, [customersQuery.data]);

  function customerLabel(message: Message): string {
    return customerNameById.get(message.customer_id) ?? "Cliente";
  }

  function whenLabel(createdAt: string): string {
    return `${formatDateInTenantTz(createdAt, timeZone)} às ${formatTimeInTenantTz(
      createdAt,
      timeZone,
    )}`;
  }

  if (messagesQuery.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (messagesQuery.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Não foi possível carregar o histórico de mensagens.
      </p>
    );
  }

  const messages = messagesQuery.data ?? [];

  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma mensagem enviada ainda.
      </p>
    );
  }

  return (
    <>
      {/* Desktop: tabela */}
      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Quando</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {messages.map((message) => (
              <TableRow key={message.id}>
                <TableCell className="font-medium text-foreground">
                  {customerLabel(message)}
                </TableCell>
                <TableCell>{getMessageTemplateLabel(message.template)}</TableCell>
                <TableCell>
                  <WhatsAppStatusBadge messageStatus={message.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {whenLabel(message.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-3 md:hidden">
        {messages.map((message) => (
          <li
            key={message.id}
            className="rounded-lg border border-border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  {customerLabel(message)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {getMessageTemplateLabel(message.template)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {whenLabel(message.created_at)}
                </p>
              </div>
              <WhatsAppStatusBadge messageStatus={message.status} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
