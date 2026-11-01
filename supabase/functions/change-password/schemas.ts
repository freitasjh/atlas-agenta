// Schemas e validação do corpo da Edge Function `change-password` — ADR-04 (troca no Auth nativo).
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

export type PasswordBodyResult =
  | { ok: true; password: string }
  | { ok: false; code: PasswordBodyErrorCode };

/**
 * Payload da ÚNICA chamada `auth.admin.updateUserById`: grava a senha nova e zera
 * `app_metadata.must_change_password` no mesmo update. As demais chaves de `app_metadata`
 * (`provider`, `providers`, marcadores internos) continuam, porque o objeto anterior é lido e
 * devolvido inteiro. Esta limpeza é a contraparte do bootstrap (ADR-05), que liga o flag.
 *
 * Nunca logue nem ecoe o retorno: ele contém a senha em claro.
 */
export function buildPasswordUpdate(
  currentAppMetadata: unknown,
  password: string,
): { password: string; app_metadata: Record<string, unknown> } {
  const base =
    typeof currentAppMetadata === "object" &&
    currentAppMetadata !== null &&
    !Array.isArray(currentAppMetadata)
      ? (currentAppMetadata as Record<string, unknown>)
      : {};
  return { password, app_metadata: { ...base, must_change_password: false } };
}

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
