// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  WEEK_DEFAULT_SLOTS_PER_PROFESSIONAL,
  capacityForDay,
  summarizeWeekDays,
  type WeekOccupancyInput,
} from "@/app/agenda/model/weekOccupancy";
import { computeDaySummary } from "@/app/agenda/model/daySummary";
import type { WorkingHour } from "@/types/domain";

const TIME_ZONE = "America/Sao_Paulo";

function appt(
  overrides: Partial<WeekOccupancyInput> & {
    id: string;
    starts_at: string;
  },
): WeekOccupancyInput {
  return {
    status: "confirmado",
    professional_id: "pr-1",
    price_cents: 5000,
    customers: { name: "Cli", whatsapp_opt_in: true },
    ends_at: "2026-11-10T13:00:00.000Z",
    ...overrides,
  };
}

function grade(
  overrides: Partial<WorkingHour> & {
    professional_id: string;
    weekday: number;
  },
): WorkingHour {
  return {
    id: `wh-${overrides.professional_id}-${overrides.weekday}`,
    tenant_id: "t-1",
    start_time: "09:00",
    end_time: "12:00",
    break_start: null,
    break_end: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  } as WorkingHour;
}

describe("capacityForDay", () => {
  it("grade 09:00–12:00 → 6 slots de 30min", () => {
    const cap = capacityForDay({
      workingHours: [grade({ professional_id: "pr-1", weekday: 2 })],
      weekday: 2,
      professionalIds: ["pr-1"],
    });
    expect(cap.capacity).toBe(6);
    expect(cap.estimated).toBe(false);
  });

  it("desconta o intervalo (break) da grade", () => {
    const cap = capacityForDay({
      workingHours: [
        grade({
          professional_id: "pr-1",
          weekday: 2,
          start_time: "08:00",
          end_time: "18:00",
          break_start: "12:00",
          break_end: "13:00",
        }),
      ],
      weekday: 2,
      professionalIds: ["pr-1"],
    });
    expect(cap.capacity).toBe(18);
    expect(cap.estimated).toBe(false);
  });

  it("soma faixas do mesmo dia (manhã + tarde)", () => {
    const cap = capacityForDay({
      workingHours: [
        grade({
          professional_id: "pr-1",
          weekday: 2,
          start_time: "08:00",
          end_time: "12:00",
        }),
        grade({
          professional_id: "pr-1",
          weekday: 2,
          start_time: "14:00",
          end_time: "18:00",
        }),
      ],
      weekday: 2,
      professionalIds: ["pr-1"],
    });
    expect(cap.capacity).toBe(16);
    expect(cap.estimated).toBe(false);
  });

  it("soma a grade de cada profissional visível", () => {
    const cap = capacityForDay({
      workingHours: [
        grade({ professional_id: "pr-1", weekday: 2 }),
        grade({ professional_id: "pr-2", weekday: 2 }),
      ],
      weekday: 2,
      professionalIds: ["pr-1", "pr-2"],
    });
    expect(cap.capacity).toBe(12);
    expect(cap.estimated).toBe(false);
  });

  it("sem grade → denominador estimado 08–18 (20 slots por profissional)", () => {
    const cap = capacityForDay({
      workingHours: [],
      weekday: 2,
      professionalIds: ["pr-1", "pr-2"],
    });
    expect(cap.capacity).toBe(2 * WEEK_DEFAULT_SLOTS_PER_PROFESSIONAL);
    expect(cap.estimated).toBe(true);
  });

  it("profissional sem faixa cai no estimado e marca o dia", () => {
    const cap = capacityForDay({
      workingHours: [grade({ professional_id: "pr-1", weekday: 2 })],
      weekday: 2,
      professionalIds: ["pr-1", "pr-2"],
    });
    expect(cap.capacity).toBe(6 + WEEK_DEFAULT_SLOTS_PER_PROFESSIONAL);
    expect(cap.estimated).toBe(true);
  });

  it("faixa de outro weekday não conta", () => {
    const cap = capacityForDay({
      workingHours: [grade({ professional_id: "pr-1", weekday: 3 })],
      weekday: 2,
      professionalIds: ["pr-1"],
    });
    expect(cap.capacity).toBe(WEEK_DEFAULT_SLOTS_PER_PROFESSIONAL);
    expect(cap.estimated).toBe(true);
  });
});

describe("summarizeWeekDays", () => {
  // Terça 2026-11-10 12:00Z = 09:00 em São Paulo (UTC-3).
  const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11"];

  it("consistente com computeDaySummary (ADR-01) para o mesmo fixture", () => {
    const lane = Array.from({ length: 10 }, (_, i) =>
      appt({ id: `a${i}`, starts_at: "2026-11-10T12:00:00.000Z" }),
    );
    const [summary] = summarizeWeekDays({
      appointments: lane,
      weekDays: WEEK,
      timeZone: TIME_ZONE,
      workingHours: [],
      // 1 profissional sem grade → 20 slots estimados (capacidade da ADR-01).
      professionalIds: ["pr-1"],
    }).filter((s) => s.day === "2026-11-10");
    const expected = computeDaySummary(lane, 20);
    expect(summary.occupied).toBe(expected.horariosOcupados);
    expect(summary.capacity).toBe(20);
    expect(summary.ocupacaoPct).toBe(expected.ocupacaoPct);
    expect(summary.ocupacaoPct).toBe(50);
    expect(summary.estimated).toBe(true);
  });

  it("cancelados não ocupam; dias vazios zeram sem quebrar", () => {
    const summaries = summarizeWeekDays({
      appointments: [
        appt({
          id: "a1",
          status: "cancelado",
          starts_at: "2026-11-10T12:00:00.000Z",
        }),
      ],
      weekDays: WEEK,
      timeZone: TIME_ZONE,
      workingHours: [],
      professionalIds: ["pr-1"],
    });
    expect(summaries).toHaveLength(3);
    const tue = summaries.find((s) => s.day === "2026-11-10");
    expect(tue?.occupied).toBe(0);
    expect(tue?.ocupacaoPct).toBe(0);
    const mon = summaries.find((s) => s.day === "2026-11-09");
    expect(mon?.occupied).toBe(0);
  });

  it("agrupa pelo dia no fuso do tenant (não pelo UTC)", () => {
    const summaries = summarizeWeekDays({
      appointments: [
        // 2026-11-10T01:00Z = 22:00 de 09/11 em São Paulo.
        appt({ id: "a1", starts_at: "2026-11-10T01:00:00.000Z" }),
      ],
      weekDays: WEEK,
      timeZone: TIME_ZONE,
      workingHours: [],
      professionalIds: ["pr-1"],
    });
    expect(summaries.find((s) => s.day === "2026-11-09")?.occupied).toBe(1);
    expect(summaries.find((s) => s.day === "2026-11-10")?.occupied).toBe(0);
  });
});
