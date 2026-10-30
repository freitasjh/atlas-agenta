import { describe, expect, it } from "vitest";

import {
  ALLOWED_SUBSCRIPTION_TRANSITIONS,
  getAllowedSubscriptionTransitions,
  getPlanLabel,
  getSubscriptionTransitionLabel,
  isSubscriptionTransitionAllowed,
} from "@/lib/subscription-status";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/types/domain";

/**
 * AC-04.2: trava a máquina de transições de assinatura inteira — cada par
 * permitido é `true`, pares proibidos (no-op, volta a `trial`, destinos fora da
 * máquina) são `false`, e nenhum destino inclui o próprio status nem `trial`.
 * Módulo puro de `src/lib`, sem DOM nem rede.
 */

// O conjunto de verdade esperado, repetido aqui de propósito (um teste que só
// reflete a implementação não prova nada — este fixa o contrato da §3.5).
const EXPECTED: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trial: ["ativo", "pendente", "cancelado"],
  ativo: ["pendente", "bloqueado", "cancelado"],
  pendente: ["ativo", "bloqueado", "cancelado"],
  bloqueado: ["ativo", "cancelado"],
  cancelado: ["ativo"],
};

describe("subscription-status — máquina de transições (ADR-04 / §3.5)", () => {
  it("o mapa exportado bate com o contrato da §3.5", () => {
    expect(ALLOWED_SUBSCRIPTION_TRANSITIONS).toEqual(EXPECTED);
  });

  it("cada par permitido retorna true em isSubscriptionTransitionAllowed", () => {
    for (const from of SUBSCRIPTION_STATUSES) {
      for (const to of EXPECTED[from]) {
        expect(isSubscriptionTransitionAllowed(from, to)).toBe(true);
      }
    }
  });

  it("pares proibidos retornam false (inclui no-op e exemplos da ADR)", () => {
    expect(isSubscriptionTransitionAllowed("cancelado", "bloqueado")).toBe(
      false,
    );
    expect(isSubscriptionTransitionAllowed("ativo", "trial")).toBe(false);
    expect(isSubscriptionTransitionAllowed("bloqueado", "pendente")).toBe(
      false,
    );
    // no-op: nunca oferecer o mesmo status como destino.
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(isSubscriptionTransitionAllowed(status, status)).toBe(false);
    }
  });

  it("todo par fora do conjunto esperado é false (varredura completa)", () => {
    for (const from of SUBSCRIPTION_STATUSES) {
      for (const to of SUBSCRIPTION_STATUSES) {
        const expected = EXPECTED[from].includes(to);
        expect(isSubscriptionTransitionAllowed(from, to)).toBe(expected);
      }
    }
  });

  it("nenhum destino inclui o próprio status nem trial", () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      const destinos = getAllowedSubscriptionTransitions(status);
      expect(destinos).not.toContain(status);
      expect(destinos).not.toContain("trial");
    }
  });
});

describe("subscription-status — rótulos pt-BR (fonte única)", () => {
  it("getSubscriptionTransitionLabel reusa os rótulos do StatusBadge", () => {
    expect(getSubscriptionTransitionLabel("ativo")).toBe("Ativo");
    expect(getSubscriptionTransitionLabel("bloqueado")).toBe("Bloqueado");
    expect(getSubscriptionTransitionLabel("trial")).toBe("Trial");
  });

  it("getPlanLabel reusa os rótulos de plans.ts", () => {
    expect(getPlanLabel("individual")).toBe("Individual");
    expect(getPlanLabel("clinica")).toBe("Clínica");
    expect(getPlanLabel("pro")).toBe("Pro");
  });
});
