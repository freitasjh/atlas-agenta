import { z } from "zod";

import { toE164BR } from "@/lib/phone";

/**
 * Schemas de validação do agendamento base (react-hook-form + resolver zod).
 *
 * Espelham os CHECKs do banco das migrations de `customers`/`appointments`
 * (ADR-01/02): a validação no cliente é UX (feedback imediato pt-BR); a trava
 * real é o CHECK/constraint no Postgres. As duas devem concordar. Mensagens em
 * pt-BR.
 */

/**
 * `customers`: name 1–120, phone E.164-BR, email opcional, whatsapp_opt_in bool.
 *
 * `phone` é normalizado para **E.164-BR canônico** (`+55` + DDD + assinante)
 * por `toE164BR` (`src/lib/phone.ts`, que espelha a especificação da ADR-01): a
 * UI aceita a digitação br, o DDI `55` é assumido automaticamente e o banco
 * guarda o valor normalizado. Entrada com comprimento inválido vira `null` e o
 * submit é recusado com erro pt-BR (RF-E164-03). `email` vazio vira `undefined`
 * (não grava string vazia).
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
    .transform((value) => toE164BR(value))
    .refine((value): value is string => value !== null, {
      message: "Informe um telefone com DDD (ex.: (11) 99999-8888).",
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
