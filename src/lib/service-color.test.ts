import { describe, expect, it } from "vitest";

import {
  SERVICE_COLOR_COUNT,
  serviceColorDotClass,
  serviceColorIndex,
} from "@/lib/service-color";

/**
 * Cobertura do helper puro de cor por serviço (ADR-01). Contrato: determinismo
 * (mesmo id → mesma saída), faixa `0..7`, e distribuição não-degenerada sobre
 * um conjunto de uuids variados. Sem DOM, sem React.
 */

// Conjunto de uuids variados (formato realista) para exercitar a dispersão.
const SAMPLE_IDS = [
  "0f8e1c2a-1111-4a2b-9c3d-000000000001",
  "1a2b3c4d-2222-4b3c-8d4e-000000000002",
  "2b3c4d5e-3333-4c4d-7e5f-000000000003",
  "3c4d5e6f-4444-4d5e-6f60-000000000004",
  "4d5e6f70-5555-4e6f-5071-000000000005",
  "5e6f7081-6666-4f70-4182-000000000006",
  "6f708192-7777-5081-3293-000000000007",
  "708192a3-8888-5192-23a4-000000000008",
  "8192a3b4-9999-52a3-13b5-000000000009",
  "92a3b4c5-aaaa-53b4-03c6-00000000000a",
  "a3b4c5d6-bbbb-54c5-f3d7-00000000000b",
  "b4c5d6e7-cccc-55d6-e3e8-00000000000c",
  "c5d6e7f8-dddd-56e7-d3f9-00000000000d",
  "d6e7f809-eeee-57f8-c30a-00000000000e",
  "e7f8091a-ffff-5809-b31b-00000000000f",
  "f8091a2b-0000-591a-a32c-000000000010",
];

describe("serviceColorIndex", () => {
  it("é determinístico: mesmo id → mesmo índice em chamadas repetidas", () => {
    for (const id of SAMPLE_IDS) {
      const first = serviceColorIndex(id);
      expect(serviceColorIndex(id)).toBe(first);
      expect(serviceColorIndex(id)).toBe(first);
    }
  });

  it("retorna sempre um inteiro na faixa 0..SERVICE_COLOR_COUNT-1", () => {
    for (const id of SAMPLE_IDS) {
      const index = serviceColorIndex(id);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(SERVICE_COLOR_COUNT);
    }
  });

  it("tem distribuição não-degenerada (não cai tudo no mesmo índice)", () => {
    const distinct = new Set(SAMPLE_IDS.map(serviceColorIndex));
    // Com 16 ids variados e 8 buckets, esperamos cobrir vários índices.
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("serviceColorDotClass", () => {
  it("é determinístico e retorna uma classe bg-service-N válida", () => {
    for (const id of SAMPLE_IDS) {
      const cls = serviceColorDotClass(id);
      expect(cls).toBe(serviceColorDotClass(id));
      expect(cls).toMatch(/^bg-service-[1-8]$/);
    }
  });

  it("casa com o índice: dotClass usa índice+1", () => {
    for (const id of SAMPLE_IDS) {
      expect(serviceColorDotClass(id)).toBe(
        `bg-service-${serviceColorIndex(id) + 1}`,
      );
    }
  });
});
