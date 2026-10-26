import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { tenantDayRangeUtc, tenantRangeUtc } from "@/lib/datetime";
import { mapSchedulingError } from "@/lib/scheduling-errors";
import { isTransitionAllowed } from "@/lib/scheduling-status";
import { useTenant } from "@/hooks/useTenant";
import {
  APPOINTMENT_CONFIRMED_VIA,
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
  type AppointmentWithRelations,
} from "@/types/domain";

/**
 * Hooks de dados de `appointments` (TanStack Query). Toda leitura valida o shape
 * (inclusive o join aninhado) com zod; nenhuma escrita envia `tenant_id` (o RLS
 * o deriva do JWT).
 *
 * A lista da agenda lê os nomes legíveis via join embutido do PostgREST numa
 * única request (sem waterfall — RNF01); o RLS cobre as tabelas relacionadas. O
 * filtro é por **faixa de dia** no fuso do tenant (convertida para UTC na borda,
 * helper de ADR-05) e, quando presente, por `professional_id` — nunca por
 * tenant (isso é do RLS).
 *
 * Erros do banco (conflito de horário `23P01`, transição inválida pelo trigger)
 * chegam como `PostgrestError`: traduza com `mapSchedulingError` na camada de
 * UI (ADR-08). PII do cliente nunca é logada em claro.
 */

/** Shape do join embutido lido pela lista da agenda (ver `AppointmentWithRelations`). */
export const appointmentRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  professional_id: z.string(),
  service_id: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  price_cents: z.number().int(),
  status: z.enum(APPOINTMENT_STATUSES),
  confirmed_at: z.string().nullable(),
  confirmed_via: z.enum(APPOINTMENT_CONFIRMED_VIA).nullable(),
  created_at: z.string(),
  customers: z
    .object({ name: z.string(), whatsapp_opt_in: z.boolean() })
    .nullable(),
  services: z
    .object({
      name: z.string(),
      duration_minutes: z.number().int(),
      price_cents: z.number().int(),
    })
    .nullable(),
  professionals: z.object({ name: z.string() }).nullable(),
});

export const appointmentListSchema = z.array(appointmentRowSchema);

/** `select` com o join embutido — uma request só, nomes legíveis inclusos. */
export const APPOINTMENT_SELECT =
  "id, tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, price_cents, status, confirmed_at, confirmed_via, created_at, customers(name, whatsapp_opt_in), services(name, duration_minutes, price_cents), professionals(name)";

const APPOINTMENTS_KEY = ["appointments"] as const;

/** Campos graváveis de um agendamento (derivados já calculados pela tela — ADR-08). */
export interface AppointmentInput {
  customerId: string;
  professionalId: string;
  serviceId: string;
  /** Instante UTC (ISO string) — já convertido na borda pela tela. */
  startsAt: string;
  /** Instante UTC (ISO string) — `startsAt + service.duration_minutes`. */
  endsAt: string;
  /** Snapshot do preço do serviço no ato, em centavos inteiros. */
  priceCents: number;
}

/**
 * Lista de agendamentos de um dia (`YYYY-MM-DD` no fuso do tenant),
 * opcionalmente filtrada por profissional, serviço e status. A faixa
 * `[início, fim)` é convertida para UTC via `tenantDayRangeUtc` (helper de
 * ADR-05).
 *
 * `serviceId` e `status` são refinamento de UX aplicado **no servidor** (`.eq`
 * do PostgREST, uma única request — RNF01). Nenhum deles é fronteira de
 * segurança: o isolamento por tenant continua 100% no RLS (derivado do JWT),
 * então um `service_id` forjado jamais vaza linhas de outro tenant. Os valores
 * vêm de selects controlados (`useServices` sob RLS; enum `AppointmentStatus`),
 * sem texto livre a validar com zod aqui.
 */
export function useAppointments({
  day,
  professionalId,
  serviceId,
  status,
}: {
  day: string;
  professionalId?: string;
  serviceId?: string;
  status?: AppointmentStatus;
}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;

  return useQuery<AppointmentWithRelations[]>({
    queryKey: [...APPOINTMENTS_KEY, { day, professionalId, serviceId, status }],
    // Precisa do fuso do tenant para derivar a faixa UTC do dia.
    enabled: !!timeZone,
    queryFn: async () => {
      const range = tenantDayRangeUtc(day, timeZone as string);
      if (!range) throw new Error("Dia inválido.");

      let query = supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .gte("starts_at", range.startUtc.toISOString())
        .lt("starts_at", range.endUtc.toISOString())
        .order("starts_at", { ascending: true });
      if (professionalId) query = query.eq("professional_id", professionalId);
      if (serviceId) query = query.eq("service_id", serviceId);
      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw error;
      return appointmentListSchema.parse(data);
    },
  });
}

/**
 * Lista de agendamentos de uma **faixa de dias** (`startDay`..`endDay`,
 * `YYYY-MM-DD` no fuso do tenant, ambos inclusivos) — usada pela visão Semana,
 * que precisa dos 7 dias de uma vez. A borda `[início, fim)` é derivada por
 * data de calendário local e convertida para UTC via `tenantRangeUtc` (ADR-01),
 * correta sob horário de verão.
 *
 * Busca os 7 dias em **uma única** request PostgREST (reusa `APPOINTMENT_SELECT`
 * e `appointmentListSchema`, sem waterfall — RNF01). Compartilha o prefixo de
 * cache `["appointments"]` com `useAppointments`, então as mutações já invalidam
 * a semana sem mudança extra.
 *
 * `professionalId`/`serviceId`/`status` são refinamento de UX no servidor (`.eq`),
 * nunca fronteira de segurança — o isolamento por tenant continua 100% no RLS
 * (derivado do JWT); nenhum `tenant_id` é enviado pelo cliente. `enabled` deixa a
 * página ativar a busca só na visão Semana (não dispara em Dia/Lista).
 */
export function useAppointmentsRange({
  startDay,
  endDay,
  professionalId,
  serviceId,
  status,
  enabled,
}: {
  startDay: string;
  endDay: string;
  professionalId?: string;
  serviceId?: string;
  status?: AppointmentStatus;
  enabled?: boolean;
}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;

  return useQuery<AppointmentWithRelations[]>({
    queryKey: [
      ...APPOINTMENTS_KEY,
      "range",
      { startDay, endDay, professionalId, serviceId, status },
    ],
    // Precisa do fuso do tenant para derivar a faixa UTC e respeita o `enabled`
    // da página (só busca na visão Semana).
    enabled: !!timeZone && (enabled ?? true),
    queryFn: async () => {
      const range = tenantRangeUtc(startDay, endDay, timeZone as string);
      if (!range) throw new Error("Semana inválida.");

      let query = supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .gte("starts_at", range.startUtc.toISOString())
        .lt("starts_at", range.endUtc.toISOString())
        .order("starts_at", { ascending: true });
      if (professionalId) query = query.eq("professional_id", professionalId);
      if (serviceId) query = query.eq("service_id", serviceId);
      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw error;
      return appointmentListSchema.parse(data);
    },
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AppointmentInput) => {
      // Sem `tenant_id` (RLS), sem `status` (default `pendente` no banco) e sem
      // `confirmed_at` (carimbado pelo trigger — ADR-04).
      const { data, error } = await supabase
        .from("appointments")
        .insert({
          customer_id: input.customerId,
          professional_id: input.professionalId,
          service_id: input.serviceId,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          price_cents: input.priceCents,
        })
        .select(APPOINTMENT_SELECT)
        .single();
      if (error) throw error;
      return appointmentRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: APPOINTMENTS_KEY });
    },
  });
}

/** Edita campos não-status (cliente/profissional/serviço/horário/preço derivado). */
export function useUpdateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: AppointmentInput & { id: string }) => {
      const { data, error } = await supabase
        .from("appointments")
        .update({
          customer_id: input.customerId,
          professional_id: input.professionalId,
          service_id: input.serviceId,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          price_cents: input.priceCents,
        })
        .eq("id", id)
        .select(APPOINTMENT_SELECT)
        .single();
      if (error) throw error;
      return appointmentRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: APPOINTMENTS_KEY });
    },
  });
}

/**
 * Muda só o `status`. Valida a transição contra `ALLOWED_TRANSITIONS` antes de
 * enviar (defesa de UX, sem request quando inválida); a trava real é o trigger
 * do banco. **Nunca** envia `confirmed_at` — o banco é a autoridade do carimbo.
 */
export function useChangeAppointmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      from,
      to,
    }: {
      id: string;
      from: AppointmentStatus;
      to: AppointmentStatus;
    }) => {
      // Recusa transição inválida sem bater no banco; a mensagem pt-BR vem de
      // `mapSchedulingError` (mesmo caminho do erro do trigger).
      if (!isTransitionAllowed(from, to)) {
        throw { code: "check_violation" };
      }

      // Ao confirmar pela UI, grava a ORIGEM explícita (`confirmed_via='manual'`)
      // para o selo da agenda distinguir determinísticamente confirmação do
      // cliente (webhook → `cliente_whatsapp`) de confirmação manual. O trigger
      // de transição só valida `status`, então não conflita.
      const patch =
        to === "confirmado"
          ? { status: to, confirmed_via: "manual" as const }
          : { status: to };

      const { data, error } = await supabase
        .from("appointments")
        .update(patch)
        .eq("id", id)
        .select(APPOINTMENT_SELECT)
        .single();
      if (error) throw error;
      return appointmentRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: APPOINTMENTS_KEY });
    },
  });
}

export { mapSchedulingError };
