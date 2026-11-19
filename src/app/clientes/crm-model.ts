/**
 * Modelo puro da ficha 360° do cliente (ADR-16, RF-24..RF-30).
 * Sem I/O, sem framework: regras de visibilidade de notas por papel e
 * filtros client-side. Testado em `crm-model.test.ts`.
 */

export type NoteVisibility = "operational" | "admin" | "appointment";

export type CrmRole = "admin" | "receptionist" | "professional";

export interface CustomerNote {
  id: string;
  customerId: string;
  authorRole: string;
  visibility: NoteVisibility;
  appointmentId: string | null;
  /** `professionals.id` do atendimento (via `appointments.professional_id`); base do gating de professional. */
  appointmentProfessionalId: string | null;
  body: string;
  createdAt: string;
}

export interface CustomerSummary {
  noShowCount: number;
  totalCount: number;
  lastVisitAt: string | null;
  /** `null` = sem dado OU recortado por papel (só admin vê — RLS é a trava). */
  avgTicketCents: number | null;
  tags: string[];
  segment: string | null;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  lgpdConsentAt: string | null;
  lgpdConsentVersion: string | null;
}

export interface CustomerHistoryItem {
  id: string;
  startsAt: string;
  serviceName: string;
  professionalName: string;
  status: string;
  /** Centavos; `null` = sem dado OU recortado por papel (só admin vê — RLS/RPC é a trava). */
  priceCents: number | null;
}

export interface CustomerPreferences {
  preferredProfessionalId: string | null;
  preferredTimeWindow: string | null;
  observations: string | null;
  tags: string[];
  segment: string | null;
}

export interface CrmFilter {
  tag: string;
  segment: string;
  minNoShow: number;
}

export interface CrmCustomerRow {
  id: string;
  name: string;
  tags: string[];
  segment: string | null;
  noShowCount: number;
}

/**
 * Visibilidade de leitura de nota por papel (ADR-08 RLS espelhada na UI como
 * defesa em profundidade — a trava real é o banco).
 * - admin: tudo.
 * - receptionist: só `operational`.
 * - professional: só `appointment` vinculada ao próprio atendimento
 *   (`appointmentProfessionalId === professionalId`).
 */
export function canViewNote(
  note: CustomerNote,
  role: CrmRole,
  ctx?: { professionalId?: string; appointmentProfessionalId?: string | null },
): boolean {
  if (role === "admin") return true;
  if (role === "receptionist") return note.visibility === "operational";
  if (note.visibility !== "appointment") return false;
  if (!note.appointmentId) return false;
  if (!ctx?.professionalId) return false;
  return ctx.appointmentProfessionalId === ctx.professionalId;
}

/** Criação de nota: admin e recepção (operacional); professional não cria. */
export function canCreateNote(role: CrmRole): boolean {
  return role === "admin" || role === "receptionist";
}

/** Filtros client-side por tag/segmento/no-show mínimo (RF-29). */
export function filterCrmCustomers(rows: CrmCustomerRow[], filter: Partial<CrmFilter>): CrmCustomerRow[] {
  const tag = (filter.tag ?? "").trim().toLowerCase();
  const segment = (filter.segment ?? "").trim().toLowerCase();
  const minNoShow = filter.minNoShow ?? 0;
  return rows.filter((row) => {
    if (tag !== "" && !row.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (segment !== "" && (row.segment ?? "").toLowerCase() !== segment) return false;
    if (row.noShowCount < minNoShow) return false;
    return true;
  });
}
