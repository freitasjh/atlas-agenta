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
      required_error: "Escolha o ramo da sua empresa.",
      invalid_type_error: "Escolha o ramo da sua empresa.",
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
