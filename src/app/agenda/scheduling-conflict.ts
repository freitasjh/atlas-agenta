import { isActiveAppointmentStatus } from "@/lib/scheduling-status";
import type { AppointmentWithRelations } from "@/types/domain";

/**
 * Checagem de conflito local (feedback imediato pt-BR na UI). Espelha a
 * constraint de exclusão parcial do banco (`appointments_no_overlap`): só
 * agendamentos **ativos** do mesmo profissional contam, e intervalos são
 * semiabertos `[início, fim)`. A trava real é o banco (`23P01`).
 */
export function hasLocalConflict(
  dayAppointments: AppointmentWithRelations[],
  excludeAppointmentId: string | null | undefined,
  professionalId: string,
  startUtc: Date,
  endUtc: Date,
): boolean {
  const startMs = startUtc.getTime();
  const endMs = endUtc.getTime();
  return dayAppointments.some((existing) => {
    if (excludeAppointmentId && existing.id === excludeAppointmentId) {
      return false;
    }
    if (existing.professional_id !== professionalId) return false;
    if (!isActiveAppointmentStatus(existing.status)) return false;
    const itemStart = new Date(existing.starts_at).getTime();
    const itemEnd = new Date(existing.ends_at).getTime();
    return startMs < itemEnd && itemStart < endMs;
  });
}
