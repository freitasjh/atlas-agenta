import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_SEND_WINDOW_MS,
  shouldAutoSendConfirmation,
} from "@/lib/confirmation-gating";

const NOW = new Date("2026-11-10T12:00:00.000Z").getTime();
const STARTS_IN_2H = new Date(NOW + 2 * 60 * 60 * 1000).toISOString();

describe("confirmation-gating — T2.0 (ADR-07)", () => {
  it("janela de envio é 24h", () => {
    expect(CONFIRMATION_SEND_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("envia quando opt-in + template ativo + dentro da janela", () => {
    expect(
      shouldAutoSendConfirmation({
        optIn: true,
        templateActive: true,
        startsAtIso: STARTS_IN_2H,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("não envia sem opt-in (LGPD R7)", () => {
    expect(
      shouldAutoSendConfirmation({
        optIn: false,
        templateActive: true,
        startsAtIso: STARTS_IN_2H,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("não envia com toggle do template desligado", () => {
    expect(
      shouldAutoSendConfirmation({
        optIn: true,
        templateActive: false,
        startsAtIso: STARTS_IN_2H,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("não envia fora da janela de 24h (R8)", () => {
    expect(
      shouldAutoSendConfirmation({
        optIn: true,
        templateActive: true,
        startsAtIso: new Date(NOW + 25 * 60 * 60 * 1000).toISOString(),
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("envia no limite inferior do debounce (nowMs - 30s → dentro dos 60s)", () => {
    expect(
      shouldAutoSendConfirmation({
        optIn: true,
        templateActive: true,
        startsAtIso: new Date(NOW - 30 * 1000).toISOString(),
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("não envia para horário passado nem data inválida", () => {
    expect(
      shouldAutoSendConfirmation({
        optIn: true,
        templateActive: true,
        startsAtIso: new Date(NOW - 60 * 60 * 1000).toISOString(),
        nowMs: NOW,
      }),
    ).toBe(false);
    expect(
      shouldAutoSendConfirmation({
        optIn: true,
        templateActive: true,
        startsAtIso: "não-é-data",
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});
