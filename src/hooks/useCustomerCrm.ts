import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/hooks/usePermissions";
import type {
  CustomerHistoryItem,
  CustomerNote,
  CustomerPreferences,
  CustomerSummary,
} from "@/app/clientes/crm-model";

/**
 * Hooks de dados da ficha 360° (ADR-16, RF-24..RF-30).
 * Degradação graciosa: colunas/tabelas/RPCs da ADR-08 podem não existir no
 * banco atual — ausência vira `null`/`[]`, nunca throw no load. A trava real
 * de visibilidade financeira é o RLS; a UI só omite.
 */

const summarySchema = z.object({
  no_show_count: z.number().int().default(0),
  total_count: z.number().int().default(0),
  last_visit_at: z.string().nullable(),
  avg_ticket_cents: z.number().int().nullable(),
  tags: z.array(z.string()).default([]),
  segment: z.string().nullable(),
  whatsapp_opt_in: z.boolean().default(false),
  whatsapp_opt_in_at: z.string().nullable(),
  lgpd_consent_at: z.string().nullable(),
  lgpd_consent_version: z.string().nullable(),
});

const historyRowSchema = z.object({
  id: z.string(),
  starts_at: z.string(),
  price_cents: z.number().int().nullable().optional(),
  status: z.string(),
  services: z.object({ name: z.string() }).nullable().optional(),
  professionals: z.object({ name: z.string() }).nullable().optional(),
});

/** Linha do RPC `customer_history` (ADR-08): `price_cents` já vem `null` p/ não-admin. */
const historyRpcItemSchema = z.object({
  id: z.string(),
  starts_at: z.string(),
  status: z.string(),
  service_name: z.string().nullable().optional(),
  professional_id: z.string().nullable().optional(),
  price_cents: z.number().int().nullable().optional(),
});

const historyRpcSchema = z.object({
  items: z.array(historyRpcItemSchema).default([]),
  total: z.number().int().default(0),
});

const preferencesRowSchema = z.object({
  preferred_professional_id: z.string().nullable().optional(),
  preferred_time_window: z.string().nullable().optional(),
  notes_summary: z.string().nullable().optional(),
  segment: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

const noteRowSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  author_role: z.string(),
  visibility: z.enum(["operational", "admin", "appointment"]),
  appointment_id: z.string().nullable(),
  body: z.string(),
  created_at: z.string(),
  appointments: z.object({ professional_id: z.string() }).nullable().optional(),
});

const CRM_KEY = ["crm"] as const;

function toSummary(fallback: {
  optIn: boolean;
  noShow: number;
  total: number;
  lastVisit: string | null;
}): CustomerSummary {
  return {
    noShowCount: fallback.noShow,
    totalCount: fallback.total,
    lastVisitAt: fallback.lastVisit,
    avgTicketCents: null,
    tags: [],
    segment: null,
    whatsappOptIn: fallback.optIn,
    whatsappOptInAt: null,
    lgpdConsentAt: null,
    lgpdConsentVersion: null,
  };
}

/** Resumo (RF-25): tenta o RPC `customer_summary`; sem ele, deriva de `appointments`. */
export function useCustomerSummary(customerId: string | null, optIn: boolean) {
  return useQuery<CustomerSummary>({
    queryKey: [...CRM_KEY, "summary", { customerId }],
    enabled: customerId !== null,
    queryFn: async () => {
      if (!customerId) throw new Error("Sem cliente.");
      try {
        const { data, error } = await supabase.rpc("customer_summary", {
          p_customer_id: customerId,
        });
        if (!error) {
          const parsed = summarySchema.safeParse(data);
          if (parsed.success) {
            const s = parsed.data;
            return {
              noShowCount: s.no_show_count,
              totalCount: s.total_count,
              lastVisitAt: s.last_visit_at,
              avgTicketCents: s.avg_ticket_cents,
              tags: s.tags,
              segment: s.segment,
              whatsappOptIn: s.whatsapp_opt_in,
              whatsappOptInAt: s.whatsapp_opt_in_at,
              lgpdConsentAt: s.lgpd_consent_at,
              lgpdConsentVersion: s.lgpd_consent_version,
            } satisfies CustomerSummary;
          }
        }
      } catch {
        // RPC ausente: cai no fallback abaixo.
      }
      const { data, error } = await supabase
        .from("appointments")
        .select("id, starts_at, status")
        .eq("customer_id", customerId)
        .order("starts_at", { ascending: false })
        .limit(200);
      if (error) return toSummary({ optIn, noShow: 0, total: 0, lastVisit: null });
      const rows = (data ?? []) as Array<{ starts_at: string; status: string }>;
      const noShow = rows.filter((r) => r.status === "nao_compareceu").length;
      return toSummary({
        optIn,
        noShow,
        total: rows.length,
        lastVisit: rows[0]?.starts_at ?? null,
      });
    },
  });
}

/** Histórico paginado (RF-26): via RPC `customer_history` (valores só p/ admin, recorte no servidor). */
export function useCustomerHistory(customerId: string | null, page = 1, pageSize = 20) {
  const { canViewFinancials } = usePermissions();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 100) : 20;
  return useQuery<CustomerHistoryItem[]>({
    queryKey: [...CRM_KEY, "history", { customerId, page: safePage, pageSize: safeSize }],
    enabled: customerId !== null,
    queryFn: async () => {
      if (!customerId) return [];
      try {
        const { data, error } = await supabase.rpc("customer_history", {
          p_customer_id: customerId,
          p_page: safePage,
          p_page_size: safeSize,
        });
        if (error) throw error;
        const parsed = historyRpcSchema.safeParse(data);
        if (!parsed.success) throw new Error("Shape inesperado.");
        const items = parsed.data.items;
        // O RPC não devolve nomes de profissionais — lookup leve (id→nome, sem financeiro).
        let names = new Map<string, string>();
        try {
          const { data: pros, error: prosError } = await supabase
            .from("professionals")
            .select("id, name");
          if (!prosError) {
            const rows = z.array(z.object({ id: z.string(), name: z.string() })).safeParse(pros);
            if (rows.success) names = new Map(rows.data.map((p) => [p.id, p.name]));
          }
        } catch {
          // Sem nomes: exibe "—", nunca quebra a aba.
        }
        return items.map((row) => ({
          id: row.id,
          startsAt: row.starts_at,
          serviceName: row.service_name ?? "—",
          professionalName: (row.professional_id ? names.get(row.professional_id) : undefined) ?? "—",
          status: row.status,
          priceCents: row.price_cents ?? null,
        }));
      } catch {
        // Banco sem RPC (migration ADR-08 ausente): leitura direta PAGINADA e
        // sem financeiro para não-admin — `price_cents` nem entra no `select`.
        const columns = canViewFinancials
          ? "id, starts_at, price_cents, status, services(name), professionals(name)"
          : "id, starts_at, status, services(name), professionals(name)";
        const { data, error } = await supabase
          .from("appointments")
          .select(columns)
          .eq("customer_id", customerId)
          .order("starts_at", { ascending: false })
          .range((safePage - 1) * safeSize, safePage * safeSize - 1);
        if (error) throw error;
        return z.array(historyRowSchema).parse(data).map((row) => ({
          id: row.id,
          startsAt: row.starts_at,
          serviceName: row.services?.name ?? "—",
          professionalName: row.professionals?.name ?? "—",
          status: row.status,
          priceCents: row.price_cents ?? null,
        }));
      }
    },
  });
}

/** Preferências (RF-27): colunas estendidas; banco sem migration → defaults. */
export function useCustomerPreferences(customerId: string | null) {
  return useQuery<CustomerPreferences>({
    queryKey: [...CRM_KEY, "preferences", { customerId }],
    enabled: customerId !== null,
    queryFn: async (): Promise<CustomerPreferences> => {
      if (!customerId) throw new Error("Sem cliente.");
      try {
        const { data, error } = await supabase
          .from("customers")
          .select("preferred_professional_id, preferred_time_window, notes_summary, segment, tags")
          .eq("id", customerId)
          .maybeSingle();
        if (error) throw error;
        const parsed = preferencesRowSchema.safeParse(data);
        if (!parsed.success) throw new Error("Shape inesperado.");
        return {
          preferredProfessionalId: parsed.data.preferred_professional_id ?? null,
          preferredTimeWindow: parsed.data.preferred_time_window ?? null,
          observations: parsed.data.notes_summary ?? null,
          tags: parsed.data.tags ?? [],
          segment: parsed.data.segment ?? null,
        };
      } catch {
        return { preferredProfessionalId: null, preferredTimeWindow: null, observations: null, tags: [], segment: null };
      }
    },
  });
}

export interface PreferencesInput {
  preferredProfessionalId: string | null;
  preferredTimeWindow: string | null;
  observations: string | null;
  tags: string[];
  segment: string | null;
}

export function useUpdateCustomerPreferences(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PreferencesInput) => {
      const { error } = await supabase
        .from("customers")
        .update({
          preferred_professional_id: input.preferredProfessionalId,
          preferred_time_window: input.preferredTimeWindow,
          notes_summary: input.observations,
          segment: input.segment,
          tags: input.tags,
        })
        .eq("id", customerId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...CRM_KEY, "preferences", { customerId }] });
      void queryClient.invalidateQueries({ queryKey: [...CRM_KEY, "summary", { customerId }] });
    },
  });
}

/** Notas por papel (RF-28): RLS recorta; sem tabela → []. */
export function useCustomerNotes(customerId: string | null) {
  return useQuery<CustomerNote[]>({
    queryKey: [...CRM_KEY, "notes", { customerId }],
    enabled: customerId !== null,
    queryFn: async () => {
      if (!customerId) return [];
      try {
        const { data, error } = await supabase
          .from("customer_notes")
          .select("id, customer_id, author_role, visibility, appointment_id, body, created_at, appointments(professional_id)")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) return [];
        return z.array(noteRowSchema).parse(data).map((row) => ({
          id: row.id,
          customerId: row.customer_id,
          authorRole: row.author_role,
          visibility: row.visibility,
          appointmentId: row.appointment_id,
          appointmentProfessionalId: row.appointments?.professional_id ?? null,
          body: row.body,
          createdAt: row.created_at,
        }));
      } catch {
        return [];
      }
    },
  });
}

export function useCreateCustomerNote(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: string }) => {
      const { error } = await supabase.from("customer_notes").insert({
        customer_id: customerId,
        visibility: "operational",
        body: input.body,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...CRM_KEY, "notes", { customerId }] });
    },
  });
}

/** Mensagens do cliente (RF-26 aba Mensagens): projeção sem PII. */
export function useCustomerMessages(customerId: string | null) {
  return useQuery<Array<{ id: string; template: string; status: string; createdAt: string }>>({
    queryKey: [...CRM_KEY, "messages", { customerId }],
    enabled: customerId !== null,
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from("messages")
        .select("id, template, status, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      const schema = z.array(z.object({
        id: z.string(),
        template: z.string(),
        status: z.string(),
        created_at: z.string(),
      }));
      return schema.parse(data).map((m) => ({ id: m.id, template: m.template, status: m.status, createdAt: m.created_at }));
    },
  });
}

/** Consentimento opt-in/LGPD (RF-30): registra com data/hora. */
export function useUpdateCustomerConsent(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { whatsappOptIn: boolean }) => {
      try {
        const { error } = await supabase.rpc("customer_consent_update", {
          p_customer_id: customerId,
          p_whatsapp_opt_in: input.whatsappOptIn,
        });
        if (error) throw error;
        return;
      } catch {
        const now = new Date().toISOString();
        const { error } = await supabase
          .from("customers")
          .update({
            whatsapp_opt_in: input.whatsappOptIn,
            whatsapp_opt_in_at: now,
            lgpd_consent_at: now,
          })
          .eq("id", customerId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...CRM_KEY, "summary", { customerId }] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}
