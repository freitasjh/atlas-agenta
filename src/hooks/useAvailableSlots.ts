import { useMemo } from "react";

import {
  generateAvailableSlots,
  type AvailableSlot,
  type BusyInterval,
} from "@/lib/scheduling-slots";
import { useAppointments } from "@/hooks/useAppointments";
import { useScheduleOverrides } from "@/hooks/useScheduleOverrides";
import { useScheduleValidity } from "@/hooks/useProfessionals";
import { useServices } from "@/hooks/useServices";
import { useTenant } from "@/hooks/useTenant";
import { useWorkingHours } from "@/hooks/useWorkingHours";

/**
 * Orquestra as leituras já existentes sob RLS (grade, exceção, vigência/passo,
 * ocupados, duração do serviço) e chama o gerador puro `generateAvailableSlots`
 * (ADR-05 agenda). Nenhuma query nova é aberta para os ocupados: reusa a MESMA
 * chave de `useAppointments({ day, professionalId })` — sem waterfall (RNF01).
 *
 * `tenant_id` nunca entra aqui: o fuso vem de `useTenant` (derivado do JWT via
 * RLS) e as faixas da grade/exceção já vêm filtradas pelo RLS. A geração roda no
 * cliente, em `useMemo`, a partir de dados já em cache.
 *
 * Em **edição** de um agendamento, passe `excludeAppointmentId` para que o
 * próprio horário que ele ocupa continue ofertável (não é descontado dos
 * ocupados).
 */

export interface UseAvailableSlotsParams {
  /** Dia alvo `YYYY-MM-DD` no fuso do tenant. */
  day: string;
  /** Profissional selecionado. */
  professionalId: string | null;
  /** Serviço selecionado (define a duração do bloco). */
  serviceId: string | null;
  /** Em edição: id do agendamento a excluir do desconto de ocupados. */
  excludeAppointmentId?: string;
  /** "Agora" injetável (teste); default do gerador é `new Date()`. */
  nowUtc?: Date;
}

export interface UseAvailableSlotsResult {
  slots: AvailableSlot[];
  /** Alguma das leituras de insumo ainda está carregando. */
  isLoading: boolean;
  /** Pronto para gerar (profissional + serviço + dia + fuso presentes). */
  isEnabled: boolean;
}

export function useAvailableSlots({
  day,
  professionalId,
  serviceId,
  excludeAppointmentId,
  nowUtc,
}: UseAvailableSlotsParams): UseAvailableSlotsResult {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone ?? null;

  const isEnabled = !!professionalId && !!serviceId && !!day && !!timeZone;

  const workingHoursQuery = useWorkingHours(isEnabled ? professionalId : null);
  const overridesQuery = useScheduleOverrides(isEnabled ? professionalId : null);
  const validityQuery = useScheduleValidity(isEnabled ? professionalId : null);
  const servicesQuery = useServices({ activeOnly: false });
  // Reusa a MESMA chave da lista do dia — não abre request novo.
  const appointmentsQuery = useAppointments({
    day,
    professionalId: professionalId ?? undefined,
  });

  const service = useMemo(
    () => servicesQuery.data?.find((s) => s.id === serviceId) ?? null,
    [servicesQuery.data, serviceId],
  );

  // O weekday (0=domingo) do dia no fuso do tenant. Evita `getDay()` do fuso
  // local do navegador: usa o próprio `day` (que já é o dia de parede do tenant).
  const weekday = useMemo(() => weekdayOf(day), [day]);

  const slots = useMemo<AvailableSlot[]>(() => {
    if (!isEnabled || !timeZone || !service) return [];

    const validity = validityQuery.data ?? null;
    const slotStepMinutes = validity?.slot_step_minutes ?? 30;

    const workingHours = (workingHoursQuery.data ?? []).filter(
      (wh) => wh.weekday === weekday,
    );

    const override =
      (overridesQuery.data ?? []).find((o) => o.override_date === day) ?? null;

    const busy: BusyInterval[] = (appointmentsQuery.data ?? [])
      .filter((a) => a.id !== excludeAppointmentId)
      .map((a) => ({ startsAt: a.starts_at, endsAt: a.ends_at }));

    return generateAvailableSlots({
      day,
      timeZone,
      durationMinutes: service.duration_minutes,
      slotStepMinutes,
      scheduleStartDate: validity?.schedule_start_date ?? null,
      scheduleEndDate: validity?.schedule_end_date ?? null,
      workingHours,
      override,
      busy,
      nowUtc,
    });
  }, [
    isEnabled,
    timeZone,
    service,
    validityQuery.data,
    workingHoursQuery.data,
    overridesQuery.data,
    appointmentsQuery.data,
    weekday,
    day,
    excludeAppointmentId,
    nowUtc,
  ]);

  const isLoading =
    isEnabled &&
    (workingHoursQuery.isLoading ||
      overridesQuery.isLoading ||
      validityQuery.isLoading ||
      servicesQuery.isLoading ||
      appointmentsQuery.isLoading);

  return { slots, isLoading, isEnabled };
}

/**
 * Weekday (0=domingo … 6=sábado) de um dia de calendário `YYYY-MM-DD`,
 * independente de fuso. Usa UTC para evitar deslocamento pelo fuso local do
 * navegador — o dia já é o dia de parede do tenant.
 */
function weekdayOf(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return -1;
  const d = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return d.getUTCDay();
}
