import { describe, expect, it } from "vitest";

import { tenantDateTimeToUtc, tenantRangeUtc } from "@/lib/datetime";

/**
 * Cobertura do helper puro `tenantRangeUtc` (ADR-01 fix da Semana). Contrato:
 * borda derivada por data de calendário local (não `N×24h`), intervalo
 * semiaberto `[startUtc, endUtc)` coerente com `tenantDayRangeUtc`, e `null`
 * para entrada inválida ou janela invertida. Sem DOM, sem React.
 */

const TZ = "America/Sao_Paulo";

describe("tenantRangeUtc", () => {
  it("devolve 00:00 local do primeiro dia e 00:00 local do dia seguinte ao último (AC-01)", () => {
    const range = tenantRangeUtc("2025-08-11", "2025-08-17", TZ);
    expect(range).not.toBeNull();

    const expectedStart = tenantDateTimeToUtc("2025-08-11", "00:00", TZ);
    const expectedEnd = tenantDateTimeToUtc("2025-08-18", "00:00", TZ);
    expect(range?.startUtc.getTime()).toBe(expectedStart?.getTime());
    expect(range?.endUtc.getTime()).toBe(expectedEnd?.getTime());
  });

  it("faixa de 7 dias em fuso sem DST tem duração nominal de 168h (AC-02)", () => {
    const range = tenantRangeUtc("2025-08-11", "2025-08-17", TZ);
    expect(range).not.toBeNull();
    const durationHours =
      (range!.endUtc.getTime() - range!.startUtc.getTime()) / 3_600_000;
    expect(durationHours).toBe(168);
  });

  it("deriva a borda por calendário (dia seguinte ao último), não somando 7×24h", () => {
    // Faixa de 1 dia: endUtc deve ser o início do dia seguinte.
    const range = tenantRangeUtc("2025-08-11", "2025-08-11", TZ);
    const expectedEnd = tenantDateTimeToUtc("2025-08-12", "00:00", TZ);
    expect(range?.endUtc.getTime()).toBe(expectedEnd?.getTime());
  });

  it("retorna null para data inválida (AC-03)", () => {
    expect(tenantRangeUtc("2025-13-40", "2025-13-47", TZ)).toBeNull();
    expect(tenantRangeUtc("2025-08-11", "2025-13-40", TZ)).toBeNull();
    expect(tenantRangeUtc("não-é-data", "2025-08-17", TZ)).toBeNull();
  });

  it("retorna null quando endDateStr é anterior a startDateStr (AC-03)", () => {
    expect(tenantRangeUtc("2025-08-17", "2025-08-11", TZ)).toBeNull();
  });

  it("é semiaberto: um instante exatamente em endUtc fica fora da faixa (AC-04)", () => {
    const range = tenantRangeUtc("2025-08-11", "2025-08-17", TZ);
    expect(range).not.toBeNull();
    const atEnd = range!.endUtc.getTime();
    // [startUtc, endUtc): o próprio endUtc não pertence ao intervalo.
    expect(atEnd < range!.startUtc.getTime()).toBe(false);
    expect(range!.startUtc.getTime() < atEnd).toBe(true);
    // Coerência com tenantDayRangeUtc: endUtc = início do dia seguinte.
    const nextDayStart = tenantDateTimeToUtc("2025-08-18", "00:00", TZ);
    expect(atEnd).toBe(nextDayStart?.getTime());
  });
});
