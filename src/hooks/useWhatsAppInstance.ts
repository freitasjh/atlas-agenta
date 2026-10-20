import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  WHATSAPP_INSTANCE_KEY,
  type CheckResponse,
  type PairResponse,
} from "@/lib/whatsapp";
import {
  WHATSAPP_CONNECTION_STATUSES,
  type WhatsAppInstance,
} from "@/types/domain";

/**
 * Hooks de dados da conexão de WhatsApp (TanStack Query).
 *
 * `useWhatsAppInstance` lê a (única) linha de `whatsapp_instances` do tenant via
 * PostgREST sob RLS — leitura comum, sem Edge Function. `usePairWhatsApp` dispara
 * a operação privilegiada `pair` via `supabase.functions.invoke("whatsapp", ...)`
 * (ADR-04). O cliente **nunca** envia `tenant_id` (o servidor o deriva do JWT); o
 * corpo só carrega `action`. Toda resposta — do PostgREST ou da função — é dado
 * não confiável: validada por zod antes do uso.
 */

/** Shape da linha de `whatsapp_instances` lida sob RLS (sem segredo). */
const whatsAppInstanceRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  evolution_instance_name: z.string(),
  connection_status: z.enum(WHATSAPP_CONNECTION_STATUSES),
  last_connected_at: z.string().nullable(),
  created_at: z.string(),
});

/** Resposta de `pair` (QR efêmero, não persistido). */
const pairResponseSchema = z.object({
  connection_status: z.enum(WHATSAPP_CONNECTION_STATUSES),
  qr_code_base64: z.string().optional(),
  last_connected_at: z.string().nullable().optional(),
});

/** Resposta de `check` (ADR-17) — espelho do `checkResponseSchema` do backend. */
const checkResponseSchema = z.object({
  connection_status: z.enum(WHATSAPP_CONNECTION_STATUSES),
  last_connected_at: z.string().nullable().optional(),
}) satisfies z.ZodType<CheckResponse>;

const WHATSAPP_INSTANCE_SELECT =
  "id, tenant_id, evolution_instance_name, connection_status, last_connected_at, created_at";

/** Intervalo de polling enquanto o tenant aguarda a leitura do QR (ms). */
const AWAITING_QR_POLL_MS = 2500;

/**
 * Instância de WhatsApp do tenant (0 ou 1 linha). Faz **polling condicional**:
 * só reconsulta enquanto `connection_status === "aguardando_qr"`, para tornar a
 * transição `aguardando_qr → conectado` observável sem reload. Em
 * `conectado`/`desconectado` (ou sem linha) o polling para. Sem WebSocket.
 */
/**
 * Lê a (única) linha de `whatsapp_instances` do tenant sob RLS. Dado canônico;
 * `null` quando o tenant ainda não tem instância.
 */
async function readWhatsAppInstanceRow(): Promise<WhatsAppInstance | null> {
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select(WHATSAPP_INSTANCE_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  return whatsAppInstanceRowSchema.parse(data);
}

/**
 * Reconcilia o estado real da Evolution com o persistido (action `check`, ADR-17)
 * em modo **best-effort**: o corpo carrega só `{ action: "check" }` (sem
 * `tenant_id`; servidor deriva do JWT). Qualquer falha — rede, Evolution fora,
 * parse inválido — é ENGOLIDA (log técnico curto, sem PII, nunca relança): o dado
 * canônico é sempre a releitura da linha. Não devolve valor; só provoca a
 * transição do lado do servidor.
 */
async function reconcileWhatsAppCheck(): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke("whatsapp", {
      body: { action: "check" },
    });
    if (error) throw error;
    checkResponseSchema.parse(data);
  } catch {
    // best-effort: falha de check não derruba a leitura nem o QR.
    console.debug("[whatsapp] check best-effort falhou; usando a linha canônica");
  }
}

export function useWhatsAppInstance() {
  return useQuery<WhatsAppInstance | null>({
    queryKey: WHATSAPP_INSTANCE_KEY,
    queryFn: async () => {
      const row = await readWhatsAppInstanceRow();
      // Só reconcilia enquanto aguardando QR: dispara `check` (best-effort) e
      // relê a linha, que é o dado canônico. Fora desse estado, a linha basta.
      if (row?.connection_status !== "aguardando_qr") return row;
      await reconcileWhatsAppCheck();
      return readWhatsAppInstanceRow();
    },
    // Polling só no estado transitório; desligado nos estados estáveis.
    refetchInterval: (query) =>
      query.state.data?.connection_status === "aguardando_qr"
        ? AWAITING_QR_POLL_MS
        : false,
  });
}

/**
 * Inicia o pareamento (operação privilegiada `pair` da Edge Function). O corpo
 * carrega apenas `action` — nenhum `tenant_id`. O QR retornado é estado efêmero
 * da página (a tela o exibe); não é persistido nem re-armazenado em cache. Em
 * sucesso, invalida a query da instância para refletir o novo estado.
 */
export function usePairWhatsApp() {
  const queryClient = useQueryClient();
  return useMutation<PairResponse>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("whatsapp", {
        body: { action: "pair" },
      });
      if (error) throw error;
      return pairResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WHATSAPP_INSTANCE_KEY });
    },
  });
}
