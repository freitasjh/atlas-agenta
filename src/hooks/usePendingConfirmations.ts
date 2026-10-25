import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { tenantDayRangeUtc } from "@/lib/datetime";
import { useTenant } from "@/hooks/useTenant";
import {
  APPOINTMENT_SELECT,
  appointmentListSchema,
} from "@/hooks/useAppointments";
import type { AppointmentWithRelations } from "@/types/domain";

/**
 * Tabela de exceções D-1 (RF-DASH-08): os agendamentos `pendente` do **dia
 * local de amanhã** (fuso do tenant). É uma LISTA de linhas, não agregação —
 * por isso reusa a leitura de `appointments` existente (mesmo `APPOINTMENT_SELECT`
 * com join de `customers`/`services`/`professionals`, mesmo `appointmentListSchema`
 * para validar), numa única request sob RLS. Nenhuma RPC nova.
 *
 * `queryKey` próprio (`["pending-confirmations", ...]`), distinto de
 * `["appointments"]`, para ser invalidável sozinha: confirmar um agendamento
 * atualiza a tabela D-1 sem mexer no cache dos agregados do resumo.
 *
 * Fronteiras: o isolamento (F1) e o recorte do `professional` (F2) são do RLS.
 * `professionalId` é conveniência de UI / defesa em profundidade (`undefined` =
 * tenant inteiro para admin/recepção); forjá-lo não vaza linhas de um colega.
 * Nenhum `tenant_id` trafega do cliente. PII do cliente (nome) é só para a tela,
 * nunca logada.
 */

/** Soma `days` a um `YYYY-MM-DD` por aritmética de calendário (sem fuso). */
function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` de hoje no fuso do tenant (en-CA já formata YYYY-MM-DD). */
function todayIsoInTenantTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const PENDING_CONFIRMATIONS_KEY = ["pending-confirmations"] as const;

export function usePendingConfirmations({
  professionalId,
}: {
  /** `undefined` = tenant inteiro (admin/recepção); id = só a própria agenda. */
  professionalId?: string;
} = {}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;

  return useQuery<AppointmentWithRelations[]>({
    queryKey: [...PENDING_CONFIRMATIONS_KEY, { professionalId }],
    // Precisa do fuso do tenant para derivar o dia local de amanhã.
    enabled: !!timeZone,
    queryFn: async () => {
      const tz = timeZone as string;
      const tomorrow = shiftIsoDate(todayIsoInTenantTz(tz), 1);
      const range = tenantDayRangeUtc(tomorrow, tz);
      if (!range) throw new Error("Dia inválido.");

      let query = supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .eq("status", "pendente")
        .gte("starts_at", range.startUtc.toISOString())
        .lt("starts_at", range.endUtc.toISOString())
        .order("starts_at", { ascending: true });
      if (professionalId) query = query.eq("professional_id", professionalId);

      const { data, error } = await query;
      if (error) throw error;
      return appointmentListSchema.parse(data);
    },
  });
}

/** `YYYY-MM-DD` do dia local de amanhã no fuso do tenant (para o link à agenda). */
export function tomorrowIsoInTenantTz(timeZone: string): string {
  return shiftIsoDate(todayIsoInTenantTz(timeZone), 1);
}
