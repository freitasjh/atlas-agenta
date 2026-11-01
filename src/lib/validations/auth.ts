import { z } from "zod";

import { BUSINESS_SEGMENTS } from "@/types/domain";

/**
 * Schemas de validação de autenticação (react-hook-form + resolver zod).
 *
 * Mensagens de validação em pt-BR, conforme convenção do produto.
 * Piso de senha = 8 caracteres; a política de complexidade fica a cargo do
 * Supabase Auth (não duplicamos regra no cliente).
 */

const emailSchema = z
  .string()
  .trim()
  .min(1, "Informe seu e-mail.")
  .email("E-mail inválido.");

const passwordSchema = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres.");

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    tradeName: z.string().trim().min(2, "Informe o nome da empresa."),
    segment: z.enum(BUSINESS_SEGMENTS, {
      errorMap: () => ({ message: "Escolha o ramo da sua empresa." }),
    }),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const requestResetSchema = z.object({
  email: emailSchema,
});

export type RequestResetInput = z.infer<typeof requestResetSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Limite do GoTrue: 72 bytes UTF-8 (não 72 caracteres). */
const MAX_PASSWORD_BYTES = 72;

/** Piso de senha em CODE POINTS — o mesmo que a Edge Function conta (ADR-04). */
const MIN_PASSWORD_CODE_POINTS = 8;

const PASSWORD_TOO_SHORT_MESSAGE = "A senha deve ter ao menos 8 caracteres.";
const PASSWORD_TOO_LONG_MESSAGE =
  "A senha deve ter no máximo 72 bytes.";

/**
 * Tamanho em bytes UTF-8: acento conta 2, emoji conta 4.
 */
function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Tamanho em code points: um emoji (par surrogate) conta 1, igual ao servidor.
 * `value.length` contaria 2 e recusaria uma senha que o servidor aceita.
 */
function passwordCodePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Senha da troca obrigatória do primeiro acesso (ADR-09), consumida pela tela
 * da ADR-10. Mínimo 8 code points, máximo 72 BYTES UTF-8 — as mesmas regras que
 * a Edge Function `change-password` aplica (ADR-04) — e confirmação igual.
 *
 * Os limites são emitidos com `code: "too_small"`/`"too_big"` de propósito:
 * `mapInitialPasswordError` classifica por código de issue, nunca por texto.
 *
 * Schema próprio: `resetPasswordSchema` (recuperação de senha) não muda, e o
 * piso de login/cadastro continua só em caracteres.
 */
export const initialPasswordSchema = z
  .object({
    password: z.string().superRefine((value, ctx) => {
      if (passwordCodePointLength(value) < MIN_PASSWORD_CODE_POINTS) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: MIN_PASSWORD_CODE_POINTS,
          type: "string",
          inclusive: true,
          message: PASSWORD_TOO_SHORT_MESSAGE,
        });
      }
      if (passwordByteLength(value) > MAX_PASSWORD_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: MAX_PASSWORD_BYTES,
          type: "string",
          inclusive: true,
          message: PASSWORD_TOO_LONG_MESSAGE,
        });
      }
    }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type InitialPasswordInput = z.infer<typeof initialPasswordSchema>;
