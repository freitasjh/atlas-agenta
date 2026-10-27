import { describe, expect, it } from "vitest";

import { resolveFeatures } from "@/lib/segment-features";
import { BUSINESS_SEGMENTS, type BusinessSegment } from "@/types/domain";

/**
 * Cobertura do gating de recursos por ramo (ADR-05, AC-05.3). `resolveFeatures`
 * é a peça pura que o `useSegmentFeatures` delega (o hook só lê
 * `tenant?.segment ?? null` do cache e repassa — sem request próprio). Provamos
 * o contrato pela função pura, igual aos testes de `resolveTerms`.
 */

describe("resolveFeatures", () => {
  it("AC-05.3: barbearia habilita a comissão", () => {
    expect(resolveFeatures("barbearia").commission).toBe(true);
  });

  it("AC-05.3: clínica, salão, null e undefined não habilitam a comissão", () => {
    expect(resolveFeatures("clinica").commission).toBe(false);
    expect(resolveFeatures("salao").commission).toBe(false);
    expect(resolveFeatures(null).commission).toBe(false);
    expect(resolveFeatures(undefined).commission).toBe(false);
  });

  it("AC-05.3: valor fora do enum degrada para desligado (nunca lança)", () => {
    const dirty = "xpto" as unknown as BusinessSegment;
    expect(() => resolveFeatures(dirty)).not.toThrow();
    expect(resolveFeatures(dirty).commission).toBe(false);
  });

  it("só barbearia liga a comissão entre os ramos canônicos", () => {
    for (const segment of BUSINESS_SEGMENTS) {
      expect(resolveFeatures(segment).commission).toBe(segment === "barbearia");
    }
  });

  it("CA-04.1 (RF-S6/AC-10): salão habilita os pacotes", () => {
    expect(resolveFeatures("salao").combos).toBe(true);
  });

  it("CA-04.1 (RF-S6/AC-10): barbearia, clínica, null e undefined não habilitam os pacotes", () => {
    expect(resolveFeatures("barbearia").combos).toBe(false);
    expect(resolveFeatures("clinica").combos).toBe(false);
    expect(resolveFeatures(null).combos).toBe(false);
    expect(resolveFeatures(undefined).combos).toBe(false);
  });

  it("CA-04.1: valor fora do enum degrada pacotes para desligado (nunca lança)", () => {
    const dirty = "xpto" as unknown as BusinessSegment;
    expect(resolveFeatures(dirty).combos).toBe(false);
  });

  it("só salão liga os pacotes entre os ramos canônicos", () => {
    for (const segment of BUSINESS_SEGMENTS) {
      expect(resolveFeatures(segment).combos).toBe(segment === "salao");
    }
  });

  it("comissão e pacotes são mutuamente exclusivos por ramo (nunca ambos ligados)", () => {
    for (const segment of BUSINESS_SEGMENTS) {
      const features = resolveFeatures(segment);
      expect(features.commission && features.combos).toBe(false);
    }
  });
});
