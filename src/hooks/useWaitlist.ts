import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { waitlistEntrySchema, type WaitlistEntry } from "@/app/lista-espera/model";

/**
 * Hooks de dados da lista de espera (Fase 4, ADR-13 sobre ADR-04).
 *
 * Escritas passam pelos RPCs `SECURITY DEFINER` da migration `waitlist`
 * (`waitlist_enqueue` idempotente por replay, `waitlist_respond`,
 * `waitlist_set_priority`, `waitlist_remove`, `waitlist_mark_attended`,
 * `waitlist_mark_expired`, `waitlist_offer_next`) — tenant/papel derivados do
 * JWT no banco, nunca do cliente. Leitura valida o shape com zod.
 *
 * Todas as queries recebem `enabled` — sem entitlement `waitlist` a página
 * nem dispara request (gating RF-11, zero request sensível).
 */

const WAITLIST_KEY = ["waitlist", "entries"] as const;

const WAITLIST_COLUMNS =
  "id, tenant_id, customer_id, service_id, professional_id, desired_start_from, desired_start_to, priority, expires_at, status, offered_slot_start, offered_slot_end, offered_professional_id, offer_expires_at, created_at";

const waitlistListSchema = z.array(waitlistEntrySchema);

const enqueueResponseSchema = z.object({
  entry_id: z.string(),
  status: z.string(),
  replayed: z.boolean(),
});

async function fetchWaitlistEntries(): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase
    .from("waitlist_entries")
    .select(WAITLIST_COLUMNS)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return waitlistListSchema.parse(data);
}

export function useWaitlistEntries(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<WaitlistEntry[]>({
    queryKey: WAITLIST_KEY,
    queryFn: fetchWaitlistEntries,
    enabled,
  });
}

export interface WaitlistEnqueueInput {
  customer_id: string;
  service_id: string;
  professional_id: string | null;
  desired_start_from: string;
  desired_start_to: string;
  priority: number;
  expires_at: string | null;
}

/**
 * Inclusão idempotente (RF-08) via `waitlist_enqueue`: duplicata ativa volta
 * como `replayed: true` sem novo INSERT (concorrência resolvida no banco).
 */
export function useEnqueueWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: WaitlistEnqueueInput): Promise<{ entryId: string; created: boolean }> => {
      const { data, error } = await supabase.rpc("waitlist_enqueue", {
        p_customer_id: input.customer_id,
        p_service_id: input.service_id,
        p_professional_id: input.professional_id,
        p_from: input.desired_start_from,
        p_to: input.desired_start_to,
        p_priority: input.priority,
        p_expires_at: input.expires_at,
      });
      if (error) throw error;
      const parsed = enqueueResponseSchema.parse(data);
      return { entryId: parsed.entry_id, created: !parsed.replayed };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    },
  });
}

const respondResponseSchema = z.object({
  entry_id: z.string(),
  status: z.string(),
  expired: z.boolean().optional(),
  appointment_id: z.string().nullable().optional(),
  next_entry_id: z.string().nullable().optional(),
});

/**
 * Resposta à oferta (RF-09) via `waitlist_respond`: aceitar cria o
 * agendamento no slot ofertado (trava 23P01); recusar/expirar passa a vaga ao
 * próximo da fila (`next_entry_id`).
 */
export function useRespondWaitlistOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { data, error } = await supabase.rpc("waitlist_respond", {
        p_entry_id: id,
        p_accept: accept,
      });
      if (error) throw error;
      return respondResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    },
  });
}

async function callEntryRpc(fn: string, id: string): Promise<void> {
  const { error } = await supabase.rpc(fn, { p_entry_id: id });
  if (error) throw error;
}

function useEntryRpc(fn: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callEntryRpc(fn, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    },
  });
}

/** Gestão manual (RF-10): atendida com trilha de auditoria. */
export function useMarkWaitlistAttended() {
  return useEntryRpc("waitlist_mark_attended");
}

/** Gestão manual (RF-10): remoção = `cancelado`, nunca DELETE físico. */
export function useRemoveWaitlistEntry() {
  return useEntryRpc("waitlist_remove");
}

/** Gestão manual (RF-10): oferta vencida vira `expirado` e repassa. */
export function useMarkWaitlistExpired() {
  return useEntryRpc("waitlist_mark_expired");
}

/** Gestão manual (RF-10): troca a prioridade (3 = topo, 1 = base). */
export function useReorderWaitlistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: number }) => {
      const { error } = await supabase.rpc("waitlist_set_priority", {
        p_entry_id: id,
        p_priority: priority,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    },
  });
}

/** Oferta manual ao primeiro elegível (slot liberado fora do fluxo automático). */
export function useOfferNextWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serviceId,
      professionalId,
    }: {
      serviceId: string;
      professionalId: string | null;
    }) => {
      const { data, error } = await supabase.rpc("waitlist_offer_next", {
        p_service_id: serviceId,
        p_professional_id: professionalId,
      });
      if (error) throw error;
      return data as { entry_id: string | null } | null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    },
  });
}
