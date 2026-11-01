// Schemas e validação do corpo da Edge Function `signup-tenant` — ADR-02 (cadastro de empresa).
//
// O corpo é DADO NÃO CONFIÁVEL. Só os campos abaixo são aceitos. Qualquer campo extra (ex.: `role`,
// `tenant_id`, `app_metadata`) é recusado pelo `.strict()`. O papel é fixo no servidor (admin).
//
// Ordem de validação (cada falha devolve um único código, estável para o cliente):
//   1. formato do corpo (campos, tipos, enum de segment) → invalid_body
//   2. senha com menos de 8 bytes UTF-8                 → password_too_short
//   3. senha com mais de 72 bytes UTF-8                 → password_too_long (limite do bcrypt no GoTrue)
import { z } from "npm:zod@3.23.8";

export const MIN_PASSWORD_BYTES = 8;
export const MAX_PASSWORD_BYTES = 72;

/** Ramos aceitos no cadastro. Mesmos literais do check `tenants_segment_check` (20250225090000). */
export const SEGMENTS = ["barbearia", "clinica", "salao"] as const;

export const signupBodySchema = z
  .object({
    email: z.string().trim().max(254).email(),
    password: z.string(),
    trade_name: z.string().trim().min(2).max(120),
    full_name: z.string().trim().min(2).max(120).optional(),
    segment: z.enum(SEGMENTS).optional(),
  })
  .strict();

export type SignupBody = z.infer<typeof signupBodySchema>;

export type SignupBodyErrorCode =
  | "invalid_body"
  | "password_too_short"
  | "password_too_long";

export type SignupBodyResult =
  | { ok: true; body: SignupBody }
  | { ok: false; code: SignupBodyErrorCode };

/**
 * Valida o corpo bruto da requisição e devolve o corpo tipado ou o código de erro. A senha não é
 * trimada: espaços fazem parte dela.
 */
export function parseSignupBody(raw: unknown): SignupBodyResult {
  const parsed = signupBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid_body" };
  }
  const { password } = parsed.data;
  const passwordBytes = new TextEncoder().encode(password).length;
  if (passwordBytes < MIN_PASSWORD_BYTES) {
    return { ok: false, code: "password_too_short" };
  }
  if (passwordBytes > MAX_PASSWORD_BYTES) {
    return { ok: false, code: "password_too_long" };
  }
  return { ok: true, body: parsed.data };
}
