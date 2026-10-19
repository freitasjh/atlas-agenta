import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { MESSAGES_KEY, type SendResponse } from "@/lib/whatsapp";
import { mapWhatsAppError } from "@/lib/whatsapp-errors";
import type { SendMessageInput } from "@/lib/validations/whatsapp";
import { MESSAGE_STATUSES, MESSAGE_TEMPLATES } from "@/types/domain";

/**
 * Hooks de dados do log de mensagens (TanStack Query).
 *
 * `useRecentMessages` lê `messages` recentes do tenant via PostgREST sob RLS, com
 * **projeção sem PII** (nunca seleciona telefone; `payload` é metadado não
 * sensível). `useSendMessage` dispara a operação privilegiada `send` via
 * `supabase.functions.invoke("whatsapp", ...)` (ADR-04) — o corpo carrega só
 * `action`/`template`/ids, **nenhum `tenant_id`** (derivado do JWT no servidor).
 *
 * Contrato de resposta de `send` (ADR-04, DONA do contrato): as condições de
 * negócio (`sent`/`duplicate`/`opt_out`/`not_connected`/`send_failed`) vêm SEMPRE
 * no corpo como `SendResponse`, mesmo quando o HTTP não é 2xx (422/409/502).
 * Como o `functions.invoke` roteia respostas não-2xx para o canal de erro, aqui
 * recuperamos o corpo do erro e, se ele validar como `SendResponse`, tratamos
 * como **resultado de negócio** (a UI decide pelo `outcome`). Só erros de
 * infra/auth (`{ error }`) seguem como erro, traduzidos por `mapWhatsAppError`.
 * Toda resposta é dado não confiável: validada por zod antes do uso.
 */

/** Shape da linha de `messages` lida sob RLS, PII-safe (sem telefone/documento). */
const messageRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  appointment_id: z.string().nullable(),
  channel: z.literal("whatsapp"),
  template: z.enum(MESSAGE_TEMPLATES),
  status: z.enum(MESSAGE_STATUSES),
  provider_message_id: z.string().nullable(),
  failure_reason: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: z.string(),
});

const messageListSchema = z.array(messageRowSchema);

/** Resposta de `send` — a UI lê `outcome` para decidir a mensagem pt-BR. */
const sendResponseSchema = z.object({
  outcome: z.enum([
    "sent",
    "duplicate",
    "opt_out",
    "not_connected",
    "send_failed",
  ]),
  message_id: z.string().nullable(),
  status: z.enum(MESSAGE_STATUSES),
  provider_message_id: z.string().nullable().optional(),
});

/**
 * Projeção **sem PII**: sem `phone`/`email`/documento. `payload` é jsonb de
 * metadados não sensíveis (ADR-03). O vínculo ao destino é só `customer_id`.
 */
const MESSAGE_SELECT =
  "id, tenant_id, customer_id, appointment_id, channel, template, status, provider_message_id, failure_reason, payload, created_at";

/** Quantidade padrão de disparos recentes exibidos no histórico. */
const DEFAULT_LIMIT = 20;

/**
 * Histórico recente de disparos do tenant (`created_at desc`, limitado). RLS
 * isola por tenant; a projeção não traz PII.
 */
export function useRecentMessages(limit: number = DEFAULT_LIMIT) {
  return useQuery({
    queryKey: [...MESSAGES_KEY, { limit }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return messageListSchema.parse(data);
    },
  });
}

/**
 * Tenta recuperar o corpo `SendResponse` de um erro do `functions.invoke`
 * (condições de negócio chegam como HTTP não-2xx com o DTO no corpo). Lê
 * `error.context` (uma `Response` do fetch) de forma defensiva; devolve `null`
 * quando o corpo não é um `SendResponse` válido (então é erro de infra/auth).
 */
async function readSendResponseFromError(
  error: unknown,
): Promise<SendResponse | null> {
  if (typeof error !== "object" || error === null || !("context" in error)) {
    return null;
  }
  const context = (error as { context: unknown }).context;
  if (
    typeof context !== "object" ||
    context === null ||
    typeof (context as { json?: unknown }).json !== "function"
  ) {
    return null;
  }
  try {
    const body = await (context as { json: () => Promise<unknown> }).json();
    const parsed = sendResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Dispara uma mensagem sob demanda (operação privilegiada `send`). O corpo
 * carrega só `action`/`template`/`customerId`/`appointmentId?` — nenhum
 * `tenant_id`. Devolve o `SendResponse` validado tanto no caminho 2xx (`data`)
 * quanto quando a condição de negócio vem como HTTP não-2xx no corpo do erro.
 * Erros de infra/auth propagam para o mapa de erro (`mapWhatsAppError`). Em
 * sucesso, invalida o histórico.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation<SendResponse, Error, SendMessageInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke("whatsapp", {
        body: {
          action: "send",
          template: input.template,
          customerId: input.customerId,
          ...(input.appointmentId
            ? { appointmentId: input.appointmentId }
            : {}),
        },
      });

      if (error) {
        // Condições de negócio (opt_out/not_connected/send_failed) vêm no corpo
        // do erro como SendResponse; recupera e trata como resultado, não erro.
        const businessOutcome = await readSendResponseFromError(error);
        if (businessOutcome) return businessOutcome;
        // Erro de infra/auth: traduz para pt-BR sem vazar schema nem PII.
        throw new Error(mapWhatsAppError(error));
      }

      return sendResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY });
    },
  });
}
