import { z } from "zod";

import { refineScheduleWindow, timeString } from "./catalog";

/**
 * Schemas de validação da vigência da grade e das exceções por data (ADR-03
 * agenda). Como em `catalog.ts`, a validação no cliente é UX (feedback imediato
 * em pt-BR); a trava real é o CHECK/constraint no Postgres:
 *
 *   - `scheduleValiditySchema` espelha `professionals_schedule_vigencia_coherent`
 *     + o CHECK `slot_step_minutes between 5 and 240`
 *     (migration `20250221090000_professionals_schedule_vigencia.sql`).
 *   - `scheduleOverrideSchema` espelha `schedule_overrides_window` + o limite de
 *     `reason` (migration `20250221091000_schedule_overrides.sql`).
 *
 * As duas camadas devem concordar. Mensagens em pt-BR.
 */

/** Data no formato `YYYY-MM-DD` (espelha a coluna `date`). */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD).");

/**
 * Vigência da grade + passo-base de slots por profissional. Datas opcionais
 * (`null` = sem limite naquela ponta); quando ambas presentes, início ≤ fim.
 * `slotStepMinutes` inteiro 5..240.
 */
export const scheduleValiditySchema = z
  .object({
    scheduleStartDate: dateString.nullable(),
    scheduleEndDate: dateString.nullable(),
    slotStepMinutes: z
      .number({ invalid_type_error: "Informe o passo em minutos." })
      .int("O passo deve ser um número inteiro de minutos.")
      .min(5, "O passo deve ser de no mínimo 5 minutos.")
      .max(240, "O passo deve ser de no máximo 240 minutos."),
  })
  .superRefine((value, ctx) => {
    if (
      value.scheduleStartDate &&
      value.scheduleEndDate &&
      value.scheduleStartDate > value.scheduleEndDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data de início deve ser anterior ou igual à de fim.",
        path: ["scheduleEndDate"],
      });
    }
  });

export type ScheduleValidityInput = z.infer<typeof scheduleValiditySchema>;

/**
 * Exceção por profissional/data. `isClosed = true` → folga/feriado, sem janela;
 * `isClosed = false` → janela atípica, validada com a MESMA regra da grade
 * (`refineScheduleWindow`). `reason` é rótulo opcional ≤ 200 chars.
 */
export const scheduleOverrideSchema = z
  .object({
    overrideDate: dateString,
    isClosed: z.boolean(),
    startTime: timeString.optional(),
    endTime: timeString.optional(),
    hasBreak: z.boolean(),
    breakStart: timeString.optional(),
    breakEnd: timeString.optional(),
    reason: z
      .string()
      .trim()
      .max(200, "O motivo deve ter no máximo 200 caracteres.")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.isClosed) return;
    refineScheduleWindow(value, ctx);
  });

export type ScheduleOverrideInput = z.infer<typeof scheduleOverrideSchema>;
