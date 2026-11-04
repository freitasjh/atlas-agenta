import { z } from "zod";

import { BUSINESS_SEGMENTS } from "@/types/domain";
import { CADASTRO_UFS, cadastroMessages } from "@/auth/cadastro-messages";
import { stripDigits } from "@/lib/mask";

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
  .min(1, cadastroMessages.errors.emailRequired)
  .email(cadastroMessages.errors.emailInvalid);

const passwordSchema = z
  .string()
  .min(8, cadastroMessages.errors.passwordMin);

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    tradeName: z
      .string()
      .trim()
      .min(2, cadastroMessages.errors.tradeName)
      .max(120, cadastroMessages.errors.tradeName),
    legalName: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .min(2, cadastroMessages.errors.legalName)
        .max(120, cadastroMessages.errors.legalName)
        .optional(),
    ),
    document: z.preprocess(stripDigits, z.string()).superRefine((value, ctx) => {
      if (value.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: cadastroMessages.errors.documentRequired,
        });
        return;
      }
      if (!isValidDocument(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: cadastroMessages.errors.documentInvalid,
        });
      }
    }),
    phoneEmpresa: z
      .preprocess(stripDigits, z.string())
      .superRefine((value, ctx) => {
        if (!/^[0-9]{10,11}$/.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: cadastroMessages.errors.phoneEmpresa,
          });
        }
      }),
    addressCep: z.preprocess(stripDigits, z.string()).superRefine((value, ctx) => {
      if (value.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: cadastroMessages.errors.addressCepRequired,
        });
        return;
      }
      if (!/^[0-9]{8}$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: cadastroMessages.errors.addressCepInvalid,
        });
      }
    }),
    addressStreet: z
      .string()
      .trim()
      .min(1, cadastroMessages.errors.addressStreet)
      .max(160, cadastroMessages.errors.addressStreet),
    addressNumber: z
      .string()
      .trim()
      .min(1, cadastroMessages.errors.addressNumber)
      .max(20, cadastroMessages.errors.addressNumber),
    addressComplement: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .max(60, cadastroMessages.errors.addressComplement)
        .optional(),
    ),
    addressCity: z
      .string()
      .trim()
      .min(1, cadastroMessages.errors.addressCity)
      .max(120, cadastroMessages.errors.addressCity),
    addressState: z
      .preprocess(upperState, z.string())
      .superRefine((value, ctx) => {
        if (!(CADASTRO_UFS as readonly string[]).includes(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: cadastroMessages.errors.addressState,
          });
        }
      }),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    fullName: z
      .string()
      .trim()
      .min(1, cadastroMessages.errors.fullName)
      .max(120, cadastroMessages.errors.fullName),
    segment: z.preprocess(
      emptyToUndefined,
      z
        .enum(BUSINESS_SEGMENTS, {
          errorMap: () => ({ message: cadastroMessages.errors.segment }),
        })
        .optional(),
    ),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: cadastroMessages.errors.passwordMismatch,
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Sentinela vazia da UI (`""` do Select/input opcional) vira ausência para o
 * zod: campo opcional não preenchido passa, sem virar default silencioso.
 */
function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim() === "" ? undefined : value;
}

/** Normaliza UF: trim + maiúscula (canônico ADR-001). Não-string vira "". */
function upperState(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isRepeatedDigit(digits: string): boolean {
  return digits.length > 0 && digits.split("").every((ch) => ch === digits[0]);
}

function checkDigit(sum: number): number {
  const rem = sum % 11;
  return rem < 2 ? 0 : 11 - rem;
}

/**
 * DV de CPF espelhado do servidor (`signup-tenant/schemas.ts`, ADR-002): d1
 * sobre as 9 primeiras (pesos 10..2), d2 sobre as 10 (pesos 11..2).
 * Sequência repetida nunca é válida.
 */
export function isValidCpf(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits) || isRepeatedDigit(digits)) return false;
  const nums = digits.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * (10 - i);
  if (nums[9] !== checkDigit(sum)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += nums[i] * (11 - i);
  return nums[10] === checkDigit(sum);
}

/**
 * DV de CNPJ espelhado do servidor: d1 sobre as 12 primeiras, d2 sobre as 13;
 * peso = 2 + ((distância da posição) mod 8), sequência 2..9 da direita p/ esquerda.
 */
export function isValidCnpj(digits: string): boolean {
  if (!/^[0-9]{14}$/.test(digits) || isRepeatedDigit(digits)) return false;
  const nums = digits.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += nums[i] * (2 + ((12 - 1 - i) % 8));
  if (nums[12] !== checkDigit(sum)) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += nums[i] * (2 + ((13 - 1 - i) % 8));
  return nums[13] === checkDigit(sum);
}

/** CPF (11) ou CNPJ (14) com DV válido — mesmo vetor do servidor. */
export function isValidDocument(digits: string): boolean {
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

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
