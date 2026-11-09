/**
 * Helpers puros da área interna `/internal-admin` (internal-operators-mfa, FE-01).
 *
 * Isolamento: este módulo NUNCA toca PostgREST de tenant direto.
 * A única prova de operador é a Edge `verify-operator` (server-side, AAL2 por
 * request). Textos em pt-BR, erro de login genérico anti-enumeração.
 */

export const MFA_PENDING_KEY = "internal-admin:mfa-pending";
export const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
export const MFA_MAX_ATTEMPTS = 5;

export const GENERIC_LOGIN_ERROR = "E-mail ou senha inválidos.";
export const OPERATOR_DENIED = "Acesso restrito a operadores internos.";

export type OperatorProof = {
  isOperator: boolean;
  aal: string;
  userId: string | null;
};

export type VerifyOperatorFn = () => Promise<OperatorProof | null>;

/** `true` quando há carimbo `mfa_pending` válido (≤10min). */
export function isMfaPendingValid(now: number, storedAt: number | null): boolean {
  if (storedAt === null || Number.isNaN(storedAt)) return false;
  return now - storedAt >= 0 && now - storedAt <= MFA_PENDING_TTL_MS;
}

/** Lê o carimbo `mfa_pending` do storage (null quando ausente/ilegível). */
export function readMfaPending(storage: Pick<Storage, "getItem">, now: number = Date.now()): number | null {
  const raw = storage.getItem(MFA_PENDING_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  void now;
  return parsed;
}

/** Grava o carimbo `mfa_pending` (início da janela de 10min). */
export function writeMfaPending(storage: Pick<Storage, "setItem">, now: number = Date.now()): void {
  storage.setItem(MFA_PENDING_KEY, String(now));
}

/** Limpa a janela `mfa_pending` (logout, sucesso do MFA, expiração). */
export function clearMfaPending(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(MFA_PENDING_KEY);
}

/** Tentativas restantes do OTP (5 tentativas, lockout após zerar). */
export function remainingAttempts(attempts: number): number {
  return Math.max(0, MFA_MAX_ATTEMPTS - attempts);
}
