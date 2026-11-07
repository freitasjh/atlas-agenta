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
    // Reason não-PII (SPEC §8): telefone/documento no motivo é vazamento de
    // PII para log/UI. Heurística (A3) cobre, além dos formatos com
    // separador (CPF 000.000.000-00, CNPJ 00.000.000/0000-00, telefone
    // 00 00000-0000), as burlas sem separador: (DDD) com parênteses colados
    // e número contínuo de 9–14 dígitos (telefone/CPF/CNPJ sem pontuação).
    // Datas com hífen (2025-03-15) não casam: os trechos são < 9 dígitos
    // contínuos. É heurística de UX — a trava real de exposição é não
    // logar o campo (SPEC §8) — e o aviso orienta a descrever sem PII.
    if (
      value.reason &&
      /(?:\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\(\d{2}\)\s?\d{4,5}-?\d{4}|\b\d{2}\s?\d{4,5}-?\d{4}\b|\b\d{9,14}\b)/.test(
        value.reason,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "O motivo não pode conter telefone ou documento. Descreva a exceção sem dados pessoais.",
        path: ["reason"],
      });
    }
    if (value.isClosed) return;
    refineScheduleWindow(value, ctx);
  });

export type ScheduleOverrideInput = z.infer<typeof scheduleOverrideSchema>;
