import { describe, expect, it } from "vitest";

import {
  GENERIC_TERMS,
  SEGMENT_TERMS,
  resolveTerms,
  type SegmentTerms,
} from "@/lib/segment-presets";
import { BUSINESS_SEGMENTS, type BusinessSegment } from "@/types/domain";

/**
 * Cobertura do contrato de terminologia por ramo (ADR-05, AC-05.1 e AC-05.3).
 *
 * `resolveTerms` é a peça pura que o `useSegmentTerms` delega (o hook só lê
 * `tenant?.segment ?? null` do cache já carregado por `useCurrentUser` e repassa
 * aqui — sem request próprio). O ambiente de teste é `node`, sem DOM/testing-
 * library (vitest.config), então provamos o comportamento observável pela
 * função pura, exatamente como a ADR-03 provou o `.catch(null)` via `tenantSchema`.
 */

const TERM_KEYS: ReadonlyArray<keyof SegmentTerms> = [
  "servicosLabel",
  "servicoLabelSingular",
  "profissionaisLabel",
  "profissionalLabelSingular",
  "clienteLabel",
];

function expectNonEmptyTerms(terms: SegmentTerms) {
  for (const key of TERM_KEYS) {
    expect(typeof terms[key]).toBe("string");
    expect(terms[key].trim()).not.toBe("");
  }
}

describe("resolveTerms", () => {
  it("AC-05.1: ramo conhecido devolve os termos do ramo", () => {
    for (const segment of BUSINESS_SEGMENTS) {
      expect(resolveTerms(segment)).toBe(SEGMENT_TERMS[segment]);
    }
  });

  it("AC-05.1: null devolve os termos genéricos", () => {
    expect(resolveTerms(null)).toBe(GENERIC_TERMS);
  });

  it("AC-05.1: undefined devolve os termos genéricos", () => {
    expect(resolveTerms(undefined)).toBe(GENERIC_TERMS);
  });

  it("AC-05.1: valor fora do enum degrada para o genérico (nunca lança)", () => {
    // Fora do tipo em runtime (dado sujo que escape por algum caminho).
    const dirty = "xpto" as unknown as BusinessSegment;
    expect(() => resolveTerms(dirty)).not.toThrow();
    expect(resolveTerms(dirty)).toBe(GENERIC_TERMS);
  });

  it("AC-05.1: nunca devolve undefined nem string vazia", () => {
    expectNonEmptyTerms(resolveTerms(null));
    for (const segment of BUSINESS_SEGMENTS) {
      expectNonEmptyTerms(resolveTerms(segment));
    }
  });

  it("AC-05.3: cada ramo cobre o enum canônico, sem chave faltando", () => {
    expect(Object.keys(SEGMENT_TERMS).sort()).toEqual(
      [...BUSINESS_SEGMENTS].sort(),
    );
    for (const segment of BUSINESS_SEGMENTS) {
      for (const key of TERM_KEYS) {
        expect(SEGMENT_TERMS[segment][key]).toBeDefined();
      }
    }
  });

  it("AC-05.3: redação do ramo difere do genérico onde deve (clínica = Paciente/Procedimentos)", () => {
    const clinica = resolveTerms("clinica");
    expect(clinica.clienteLabel).toBe("Paciente");
    expect(clinica.servicosLabel).toBe("Procedimentos");
    expect(clinica.clienteLabel).not.toBe(GENERIC_TERMS.clienteLabel);
  });
});
