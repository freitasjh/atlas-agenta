// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  MFA_MAX_ATTEMPTS,
  isMfaPendingValid,
  remainingAttempts,
} from "@/internal-admin/internalOperator";

describe("internalOperator (mfa_pending)", () => {
  it("janela válida dentro de 10min", () => {
    const now = 1_000_000;
    expect(isMfaPendingValid(now, now - 9 * 60 * 1000)).toBe(true);
  });

  it("janela expirada após 10min nega sem dado", () => {
    const now = 1_000_000;
    expect(isMfaPendingValid(now, now - 11 * 60 * 1000)).toBe(false);
    expect(isMfaPendingValid(now, null)).toBe(false);
  });

  it("5 tentativas zeram as restantes (lockout)", () => {
    expect(remainingAttempts(0)).toBe(MFA_MAX_ATTEMPTS);
    expect(remainingAttempts(5)).toBe(0);
    expect(remainingAttempts(9)).toBe(0);
  });
});
