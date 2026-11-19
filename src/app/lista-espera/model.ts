import { z } from "zod";

/**
 * Modelo da lista de espera (Fase 4, ADR-13 sobre ADR-04 / RF-07..RF-11).
 *
 * Espelha o contrato real do backend (`20261125090000_waitlist.sql`):
 * status pt-BR no masculino (aguardando|ofertado|confirmado|recusado|
 * expirado|atendido|cancelado — `cancelado` = remoção manual, sem DELETE),
 * colunas `priority`, `expires_at`, `desired_start_from/to`,
 * `offered_slot_start/end`, `offered_professional_id`.
 *
 * Só lógica pura: tipos, schema zod (valida o shape lido do PostgREST) e
 * helpers de ordenação/filtro/idempotência/countdown. Rede vive em
 * `src/hooks/useWaitlist.ts` (RPCs do ADR-04).
 */

export const WAITLIST_STATUSES = [
  "aguardando",
  "ofertado",
  "confirmado",
  "recusado",
  "expirado",
  "atendido",
  "cancelado",
] as const;

export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

/** Entradas que ainda ocupam a fila (idempotência e ordenação olham só elas). */
export const ACTIVE_STATUSES: readonly WaitlistStatus[] = [
  "aguardando",
  "ofertado",
] as const;

export function isActiveStatus(status: WaitlistStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export type WaitlistPriority = number;

/** 3 = alta, 2 = normal, 1 = baixa (fila ordena `priority` desc). */
export function priorityLabel(priority: number): "alta" | "normal" | "baixa" {
  if (priority >= 3) return "alta";
  if (priority === 2) return "normal";
  return "baixa";
}

export const waitlistEntrySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  service_id: z.string(),
  professional_id: z.string().nullable(),
  desired_start_from: z.string(),
  desired_start_to: z.string(),
  priority: z.number().int().default(0),
  expires_at: z.string().nullable().default(null),
  status: z.enum(WAITLIST_STATUSES),
  offered_slot_start: z.string().nullable().default(null),
  offered_slot_end: z.string().nullable().default(null),
  offered_professional_id: z.string().nullable().default(null),
  offer_expires_at: z.string().nullable().default(null),
  created_at: z.string(),
});

export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

/** Entrada com nomes legíveis (join embutido do PostgREST) para a tabela. */
export interface WaitlistEntryView extends WaitlistEntry {
  customerName: string;
  serviceName: string;
  professionalName: string;
}

export interface WaitlistFilter {
  search: string;
  status: WaitlistStatus | "todas";
  serviceId: string | "todos";
  professionalId: string | "todos";
}

export function createWaitlistFilter(): WaitlistFilter {
  return { search: "", status: "todas", serviceId: "todos", professionalId: "todos" };
}

/**
 * Ordenação da fila (RF-07): `priority` desc, `created_at` asc. Não muta o
 * array de entrada.
 */
export function sortWaitlistEntries<T extends Pick<WaitlistEntry, "priority" | "created_at">>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.created_at < b.created_at) return -1;
    if (a.created_at > b.created_at) return 1;
    return 0;
  });
}

/** Filtro client-side (busca + status + serviço + profissional). */
export function filterWaitlistEntries(
  entries: readonly WaitlistEntryView[],
  filter: WaitlistFilter,
): WaitlistEntryView[] {
  const term = filter.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.status !== "todas" && entry.status !== filter.status) return false;
    if (filter.serviceId !== "todos" && entry.service_id !== filter.serviceId) return false;
    if (filter.professionalId !== "todos" && entry.professional_id !== filter.professionalId)
      return false;
    if (term && !entry.customerName.toLowerCase().includes(term)) return false;
    return true;
  });
}

export interface WaitlistEnqueueKey {
  customer_id: string;
  service_id: string;
  professional_id: string | null;
  desired_start_from: string;
  desired_start_to: string;
}

/**
 * Idempotência da inclusão (RF-08): entrada ativa com mesma chave
 * (cliente + serviço + profissional + período) evita duplicata. Espelha a
 * condição do `waitlist_enqueue` (profissional null casa com null).
 */
export function findDuplicateEntry(
  entries: readonly WaitlistEntry[],
  key: WaitlistEnqueueKey,
): WaitlistEntry | null {
  return (
    entries.find(
      (entry) =>
        isActiveStatus(entry.status) &&
        entry.customer_id === key.customer_id &&
        entry.service_id === key.service_id &&
        (entry.professional_id ?? null) === (key.professional_id ?? null) &&
        entry.desired_start_from === key.desired_start_from &&
        entry.desired_start_to === key.desired_start_to,
    ) ?? null
  );
}

/** ms restantes até `expiresAt` (nunca negativo). */
export function remainingMs(expiresAt: string, now: number = Date.now()): number {
  return Math.max(0, new Date(expiresAt).getTime() - now);
}

export function isOfferExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  return remainingMs(expiresAt, now) <= 0;
}

/** Formato do countdown da oferta (RF-09): `MM:SS`. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}
