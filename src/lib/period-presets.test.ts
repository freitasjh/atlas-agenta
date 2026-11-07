import { describe, expect, it } from "vitest";

import {
  monthRangeIso,
  resolvePresetRange,
  shiftIsoDate,
  todayIsoInTenantTz,
} from "@/lib/period-presets";

describe("period-presets", () => {
  it("monthRangeIso devolve primeiro e último dia do mês", () => {
    expect(monthRangeIso("2026-09-15")).toEqual({
      first: "2026-09-01",
      last: "2026-09-30",
    });
    expect(monthRangeIso("2026-02-10")).toEqual({
      first: "2026-02-01",
      last: "2026-02-28",
    });
  });

  it("resolvePresetRange ancora presets em today", () => {
    expect(resolvePresetRange("mes", "2026-09-15")).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(resolvePresetRange("mes-passado", "2026-09-15")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    // Virada de ano: janeiro -> dezembro anterior.
    expect(resolvePresetRange("mes-passado", "2026-01-10")).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
  });

  it("shiftIsoDate atravessa fronteira de mês", () => {
    expect(shiftIsoDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftIsoDate("2026-09-01", 30)).toBe("2026-10-01");
  });

  it("todayIsoInTenantTz devolve YYYY-MM-DD", () => {
    expect(todayIsoInTenantTz("America/Sao_Paulo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
