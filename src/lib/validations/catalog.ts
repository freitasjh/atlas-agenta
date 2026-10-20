import { z } from "zod";

/**
 * Schemas de validação do cadastro operacional (react-hook-form + resolver zod).
 *
 * Espelham **exatamente** os CHECKs do banco (migration `20250217090000_
 * operational_catalog.sql`): a validação no cliente é UX (feedback imediato em
 * pt-BR); a trava real é o CHECK/constraint no Postgres. As duas devem concordar.
 * Mensagens em pt-BR, conforme convenção do produto.
 */

/** `services`: name 1–120, duration_minutes > 0, price_cents >= 0, active. */
export const serviceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do serviço.")
    .max(120, "O nome deve ter no máximo 120 caracteres."),
  durationMinutes: z
    .number({ invalid_type_error: "Informe a duração em minutos." })
    .int("A duração deve ser um número inteiro de minutos.")
    .positive("A duração deve ser maior que zero."),
  priceCents: z
    .number({ invalid_type_error: "Informe o preço." })
    .int("O preço deve ser um valor inteiro em centavos.")
    .min(0, "O preço não pode ser negativo."),
  active: z.boolean(),
});

export type ServiceInput = z.infer<typeof serviceSchema>;

/** `professionals`: name 1–120, active. `profile_id` é somente-leitura. */
export const professionalSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do profissional.")
    .max(120, "O nome deve ter no máximo 120 caracteres."),
  active: z.boolean(),
});

export type ProfessionalInput = z.infer<typeof professionalSchema>;

/** Hora no formato `HH:MM` (espelha a coluna `time` da grade). */
export const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).");

/**
 * Campos de janela de expediente + intervalo opcional, compartilhados entre a
 * grade semanal (`workingHoursDaySchema`) e a exceção de data atípica
 * (`scheduleOverrideSchema`, ADR-03). Mantê-los numa só forma permite reusar a
 * mesma validação em ambos (uma só fonte de verdade de UX).
 */
export interface ScheduleWindowFields {
  startTime?: string;
  endTime?: string;
  hasBreak: boolean;
  breakStart?: string;
  breakEnd?: string;
}

/**
 * Valida a janela de expediente + intervalo quando ela está ativa (o dia da
 * grade está ligado, ou a exceção é de janela atípica): janela coerente
 * (`start < end`) e, se houver intervalo, ambos-ou-nenhum, coerente e dentro da
 * janela — espelhando os CHECKs `working_hours_window` /
 * `working_hours_break_coherent` e `schedule_overrides_window`. Reusada por
 * `workingHoursDaySchema` e `scheduleOverrideSchema` para evitar divergência.
 */
export function refineScheduleWindow(
  fields: ScheduleWindowFields,
  ctx: z.RefinementCtx,
): void {
  if (!fields.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o horário de início.",
      path: ["startTime"],
    });
  }
  if (!fields.endTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o horário de fim.",
      path: ["endTime"],
    });
  }
  if (fields.startTime && fields.endTime && fields.startTime >= fields.endTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "O início deve ser antes do fim.",
      path: ["endTime"],
    });
  }

  if (!fields.hasBreak) return;

  // Intervalo: ambos-ou-nenhum.
  if (!fields.breakStart) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o início do intervalo.",
      path: ["breakStart"],
    });
  }
  if (!fields.breakEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o fim do intervalo.",
      path: ["breakEnd"],
    });
  }
  if (
    fields.breakStart &&
    fields.breakEnd &&
    fields.breakStart >= fields.breakEnd
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "O início do intervalo deve ser antes do fim.",
      path: ["breakEnd"],
    });
  }
  // Intervalo dentro da janela.
  if (
    fields.startTime &&
    fields.breakStart &&
    fields.breakStart < fields.startTime
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "O intervalo deve começar dentro do expediente.",
      path: ["breakStart"],
    });
  }
  if (fields.endTime && fields.breakEnd && fields.breakEnd > fields.endTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "O intervalo deve terminar dentro do expediente.",
      path: ["breakEnd"],
    });
  }
}

/**
 * Um dia da grade. Quando `enabled` (o profissional atende no dia), exige janela
 * coerente e, se houver intervalo, que seja ambos-ou-nenhum, coerente e dentro
 * da janela — espelhando `working_hours_window` e `working_hours_break_coherent`.
 */
export const workingHoursDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    enabled: z.boolean(),
    startTime: timeString.optional(),
    endTime: timeString.optional(),
    hasBreak: z.boolean(),
    breakStart: timeString.optional(),
    breakEnd: timeString.optional(),
  })
  .superRefine((day, ctx) => {
    if (!day.enabled) return;
    refineScheduleWindow(day, ctx);
  });

export type WorkingHoursDayInput = z.infer<typeof workingHoursDaySchema>;

/** A grade inteira: os 7 dias da semana. */
export const weeklyScheduleSchema = z.object({
  days: z.array(workingHoursDaySchema).length(7),
});

export type WeeklyScheduleInput = z.infer<typeof weeklyScheduleSchema>;
