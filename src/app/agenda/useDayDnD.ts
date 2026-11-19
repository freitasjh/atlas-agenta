import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  addMinutes,
  tenantDateTimeToUtc,
} from "@/lib/datetime";
import { mapSchedulingError, useUpdateAppointment } from "@/hooks/useAppointments";
import type { AppointmentWithRelations } from "@/types/domain";

/**
 * DnD intra-dia da visão Dia (ADR-03): arrastar **só dentro do mesmo dia e do
 * mesmo profissional**. O drop chama o update de horário existente
 * (`starts_at`/`ends_at` preservando a duração); conflito (409/`23P01`) faz
 * recovery — o bloco fica na origem (sem update otimista) e o toast oferece
 * "Ver conflito".
 *
 * O hook centraliza: item arrastado, permissão de soltura por coluna,
 * mutação com recovery e a mensagem do `aria-live`.
 */

interface UseDayDnDInput {
  /** `YYYY-MM-DD` do dia em foco (o DnD nunca troca de dia). */
  day: string;
  timeZone: string;
}

/** Lê `error.code` sem assumir o shape (PostgrestError defensivo). */
function isConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23P01"
  );
}

export function useDayDnD({ day, timeZone }: UseDayDnDInput) {
  const update = useUpdateAppointment();
  const [dragged, setDragged] = useState<AppointmentWithRelations | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);

  const startDrag = useCallback((appointment: AppointmentWithRelations) => {
    setDragged(appointment);
  }, []);

  const endDrag = useCallback(() => {
    setDragged(null);
  }, []);

  /**
   * A coluna aceita a soltura quando há arrasto ativo **e** o profissional é o
   * mesmo (`intra-dia`). Na visão de coluna única (`acceptAny`), a coluna já é
   * a própria agenda — aceita qualquer arrasto ativo.
   */
  const canDropOn = useCallback(
    (targetProfessionalId: string | null, acceptAny: boolean): boolean => {
      if (!dragged) return false;
      if (acceptAny) return true;
      return dragged.professional_id === targetProfessionalId;
    },
    [dragged],
  );

  /**
   * Move o agendamento para `newStartMinutes` (minutos do dia, já com snap de
   * 30min feito pelo chamador), preservando a duração. Retorna `true` quando
   * persistiu; `false` em conflito (com recovery: nada muda localmente).
   */
  const move = useCallback(
    async (
      appointment: AppointmentWithRelations,
      newStartMinutes: number,
    ): Promise<boolean> => {
      const durationMinutes = Math.round(
        (new Date(appointment.ends_at).getTime() -
          new Date(appointment.starts_at).getTime()) / 60000,
      );
      const hour = Math.floor(newStartMinutes / 60);
      const minute = newStartMinutes % 60;
      const time = `${hour.toString().padStart(2, "0")}:${minute
        .toString()
        .padStart(2, "0")}`;
      const startUtc = tenantDateTimeToUtc(day, time, timeZone);
      if (!startUtc) {
        setAnnouncement("Horário inválido. Movimento cancelado.");
        return false;
      }
      const endUtc = addMinutes(startUtc, durationMinutes);
      setMovingId(appointment.id);
      try {
        await update.mutateAsync({
          id: appointment.id,
          customerId: appointment.customer_id ?? "",
          professionalId: appointment.professional_id,
          serviceId: appointment.service_id,
          comboId: appointment.combo_id,
          startsAt: startUtc.toISOString(),
          endsAt: endUtc.toISOString(),
          priceCents: appointment.price_cents,
        });
        toast.success(`Agendamento movido para ${time}.`);
        setAnnouncement(`Agendamento movido para ${time}.`);
        return true;
      } catch (error) {
        const message = mapSchedulingError(error);
        if (isConflictError(error)) {
          toast.error(message, {
            description: "O bloco foi mantido no horário de origem.",
            action: {
              label: "Ver conflito",
              onClick: () =>
                setAnnouncement(
                  `Conflito: ${message} Verifique os agendamentos deste profissional neste horário.`,
                ),
            },
          });
          setAnnouncement(`Conflito: ${message} O bloco voltou à origem.`);
        } else {
          toast.error(message);
          setAnnouncement("Não foi possível mover. Tente novamente.");
        }
        return false;
      } finally {
        setMovingId(null);
      }
    },
    [day, timeZone, update],
  );

  return {
    dragged,
    announcement,
    movingId,
    isMoving: update.isPending,
    startDrag,
    endDrag,
    canDropOn,
    move,
    announce: setAnnouncement,
  };
}
