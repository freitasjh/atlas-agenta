// Schemas e validação do corpo da Edge Function `change-password` — ADR-08 (Super Admin).
//
// O corpo é DADO NÃO CONFIÁVEL. Só `{ password: string }` é aceito: qualquer campo extra
// (ex.: `user_id`) é recusado pelo `.strict()`. O `userId` vem do JWT validado pelo GoTrue no
// handler, nunca daqui.
//
// Ordem de validação (cada falha devolve um único código, estável para o cliente):
//   1. formato do corpo         → invalid_body
//   2. mínimo de 8 caracteres   → password_too_short
//   3. máximo de 72 bytes UTF-8 → password_too_long (limite do bcrypt no GoTrue)
//   4. igual à provisória       → password_is_initial
import { z } from "npm:zod@3.23.8";
import { PROVISIONAL_PASSWORD } from "../_shared/super-admin-bootstrap.ts";

export const MIN_PASSWORD_CHARS = 8;
export const MAX_PASSWORD_BYTES = 72;

export const changePasswordBodySchema = z
  .object({ password: z.string() })
  .strict();

export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export type PasswordBodyErrorCode =
  | "invalid_body"
  | "password_too_short"
  | "password_too_long"
  | "password_is_initial";

/**
 * Linha devolvida por `claim_password_change` (dado vindo do banco, validado antes de uso).
 * `claim_token` é a expiração da reserva tomada; nulo quando a troca não foi reservada.
 */
export const claimRowSchema = z.object({
  claim_status: z.enum(["claimed", "in_progress", "not_required"]),
  claim_token: z.string().nullable(),
});

export type ClaimRow = z.infer<typeof claimRowSchema>;

/**
 * Diz se a falha da escrita no Auth é uma resposta HTTP 4xx do GoTrue. Essa resposta garante que
 * a senha não mudou, então a reserva pode ser liberada. Timeout, erro de rede (sem status) e 5xx
 * podem deixar a escrita em curso no GoTrue: nesses casos a reserva expira sozinha em 60 s.
 */
export function isDefinitiveAuthRejection(status: unknown): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

export type PasswordBodyResult =
  | { ok: true; password: string }
  | { ok: false; code: PasswordBodyErrorCode };

/**
 * Valida o corpo bruto da requisição e devolve a senha nova ou o código de erro. Não trima a
 * senha: espaços fazem parte dela.
 */
export function parseChangePasswordBody(raw: unknown): PasswordBodyResult {
  const parsed = changePasswordBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid_body" };
  }

  const { password } = parsed.data;

  if (Array.from(password).length < MIN_PASSWORD_CHARS) {
    return { ok: false, code: "password_too_short" };
  }

  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return { ok: false, code: "password_too_long" };
  }

  if (password === PROVISIONAL_PASSWORD) {
    return { ok: false, code: "password_is_initial" };
  }

  return { ok: true, password };
}
