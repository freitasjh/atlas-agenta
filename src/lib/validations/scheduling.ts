import { z } from "zod";

/**
 * Schemas de validação do agendamento base (react-hook-form + resolver zod).
 *
 * Espelham os CHECKs do banco das migrations de `customers`/`appointments`
 * (ADR-01/02): a validação no cliente é UX (feedback imediato pt-BR); a trava
 * real é o CHECK/constraint no Postgres. As duas devem concordar. Mensagens em
 * pt-BR.
 */

/** E.164: `+` opcional seguido de 8–15 dígitos, primeiro dígito não-zero. */
const E164_REGEX = /^\+?[1-9]\d{7,14}$/;

/**
 * `customers`: name 1–120, phone E.164, email opcional, whatsapp_opt_in bool.
 *
 * `phone` é normalizado (remove espaços, parênteses, hífens e pontos) antes de
 * validar E.164 — a UI aceita a digitação br e normaliza; o banco guarda o
 * valor normalizado. `email` vazio vira `undefined` (não grava string vazia).
 */
export const customerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do cliente.")
    .max(120, "O nome deve ter no máximo 120 caracteres."),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s()\-.]/g, ""))
    .refine((value) => E164_REGEX.test(value), {
      message: "Informe um telefone válido (ex.: +5511999998888).",
    }),
  email: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) => value === undefined || z.string().email().safeParse(value).success,
      { message: "Informe um e-mail válido." },
    ),
  whatsappOptIn: z.boolean(),
});

export type CustomerInput = z.infer<typeof customerSchema>;

/**
 * `appointments` (form): cliente/profissional/serviço (uuid) + início
 * (data+hora). `endsAt` e `priceCents` **não** são campos do form — são
 * derivados no submit a partir do serviço escolhido (ADR-08) e recalculados/
 * travados no banco.
 */
export const appointmentSchema = z.object({
  customerId: z.string().uuid("Selecione um cliente."),
  professionalId: z.string().uuid("Selecione um profissional."),
  serviceId: z.string().uuid("Selecione um serviço."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida."),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido (HH:MM)."),
});

export type AppointmentInput = z.infer<typeof appointmentSchema>;
