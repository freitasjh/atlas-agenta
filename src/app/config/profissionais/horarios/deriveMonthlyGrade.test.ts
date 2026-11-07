import { describe, expect, it } from "vitest";

import {
  deriveMonthlyGrade,
  findBatchConflicts,
  isRetroactiveEditBlocked,
} from "@/app/config/profissionais/horarios/deriveMonthlyGrade";
import { generateAvailableSlots } from "@/lib/scheduling-slots";
import type { ScheduleOverride, WorkingHour } from "@/types/domain";

const TZ = "America/Sao_Paulo";
const PAST = new Date("2000-01-01T00:00:00.000Z");

function wh(partial: Partial<WorkingHour>): WorkingHour {
  return {
    id: "wh",
    tenant_id: "t",
    professional_id: "p",
    weekday: 1,
    start_time: "09:00",
    end_time: "18:00",
    break_start: null,
    break_end: null,
    created_at: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

function ov(partial: Partial<ScheduleOverride>): ScheduleOverride {
  return {
    id: "o",
    tenant_id: "t",
    professional_id: "p",
    override_date: "2025-03-10",
    is_closed: false,
    start_time: null,
    end_time: null,
    break_start: null,
    break_end: null,
    reason: null,
    created_at: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("deriveMonthlyGrade", () => {
  it("vigência nula = aberta (dia útil com grade = grade)", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })], // segunda
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const dia10 = days.find((d) => d.date === "2025-03-10");
    expect(dia10?.status).toBe("grade");
    expect(dia10?.windows).toEqual([
      { startTime: "09:00", endTime: "18:00", breakStart: null, breakEnd: null },
    ]);
  });

  it("fim de vigência datado: depois do fim = fora-vigencia", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: "2025-03-07",
    });
    expect(days.find((d) => d.date === "2025-03-10")?.status).toBe(
      "fora-vigencia",
    );
    expect(days.find((d) => d.date === "2025-03-03")?.status).toBe("grade");
  });

  it("override fecha: folga vence grade", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })],
      overrides: [ov({ override_date: "2025-03-10", is_closed: true })],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const dia = days.find((d) => d.date === "2025-03-10");
    expect(dia?.status).toBe("folga");
    expect(dia?.windows).toEqual([]);
  });

  it("override atípico: janela da exceção vence grade", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 6, start_time: "09:00", end_time: "18:00" })],
      overrides: [
        ov({
          override_date: "2025-03-15", // sábado
          is_closed: false,
          start_time: "09:00",
          end_time: "13:00",
        }),
      ],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const dia = days.find((d) => d.date === "2025-03-15");
    expect(dia?.status).toBe("atipico");
    expect(dia?.windows[0]?.endTime).toBe("13:00");
  });

  it("weekday sem grade = livre", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    // 2025-03-16 é domingo (weekday 0), sem grade.
    expect(days.find((d) => d.date === "2025-03-16")?.status).toBe("livre");
  });

  it("multi-faixa no mesmo weekday = união de janelas", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [
        wh({ weekday: 1, start_time: "09:00", end_time: "12:00" }),
        wh({ weekday: 1, start_time: "14:00", end_time: "18:00" }),
      ],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    expect(days.find((d) => d.date === "2025-03-10")?.windows).toHaveLength(2);
  });

  it("mês tem o número certo de dias e todos com data YYYY-MM-DD", () => {
    const fev = deriveMonthlyGrade({
      month: "2025-02",
      workingHours: [],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    expect(fev).toHaveLength(28);
    expect(fev.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
  });

  it("DST São Paulo: labels de parede estáveis em meses diferentes", () => {
    const mar = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1, start_time: "09:00", end_time: "12:00" })],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const fev = deriveMonthlyGrade({
      month: "2025-02",
      workingHours: [wh({ weekday: 1, start_time: "09:00", end_time: "12:00" })],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    expect(mar.find((d) => d.date === "2025-03-10")?.windows[0]?.startTime).toBe(
      "09:00",
    );
    expect(fev.find((d) => d.date === "2025-02-17")?.windows[0]?.startTime).toBe(
      "09:00",
    );
  });

  it("mensal == useAvailableSlots por dia (propriedade, caso grade)", () => {
    const grade = [wh({ weekday: 1, start_time: "09:00", end_time: "12:00" })];
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: grade,
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    // generateAvailableSlots para o dia 10 com a mesma grade deve ofertar slots
    // dentro da janela derivada (09:00 existe).
    const slots = generateAvailableSlots({
      day: "2025-03-10",
      timeZone: TZ,
      durationMinutes: 60,
      slotStepMinutes: 60,
      scheduleStartDate: null,
      scheduleEndDate: null,
      workingHours: grade,
      override: null,
      busy: [],
      nowUtc: PAST,
    });
    expect(slots.map((s) => s.label)).toContain("09:00");
    const dia = days.find((d) => d.date === "2025-03-10");
    expect(dia?.status).toBe("grade");
    expect(dia?.windows[0]?.startTime).toBe(slots[0]?.label);
  });

  it("passado sem slot: isPast calculado quando today informado", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
      today: "2025-03-15",
    });
    expect(days.find((d) => d.date === "2025-03-10")?.isPast).toBe(true);
    expect(days.find((d) => d.date === "2025-03-17")?.isPast).toBe(false);
  });
});

describe("findBatchConflicts", () => {
  const grade = [wh({ weekday: 1, start_time: "09:00", end_time: "18:00" })];

  it("sem appointment futuro = sem conflito", () => {
    expect(
      findBatchConflicts({
        drafts: grade,
        appointments: [],
        nowUtc: new Date("2025-03-01T12:00:00.000Z"),
        timeZone: TZ,
      }),
    ).toEqual([]);
  });

  it("appointment futuro ativo fora da grade nova = conflito", () => {
    const conflicts = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "09:00", end_time: "12:00" })],
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-10T17:00:00.000Z", // 14:00 BRT, fora de 09-12
          endsAt: "2025-03-10T18:00:00.000Z",
          status: "confirmado",
        },
      ],
      nowUtc: new Date("2025-03-01T12:00:00.000Z"),
      timeZone: TZ,
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.code).toBe("APPOINTMENT_CONFLICT_FUTURE");
  });

  it("cancelado não conflita; passado não bloqueia", () => {
    const conflicts = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "09:00", end_time: "12:00" })],
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-10T17:00:00.000Z",
          endsAt: "2025-03-10T18:00:00.000Z",
          status: "cancelado",
        },
        {
          id: "a2",
          startsAt: "2025-02-10T17:00:00.000Z", // passado
          endsAt: "2025-02-10T18:00:00.000Z",
          status: "confirmado",
        },
      ],
      nowUtc: new Date("2025-03-01T12:00:00.000Z"),
      timeZone: TZ,
    });
    expect(conflicts).toEqual([]);
  });
});

describe("findBatchConflicts × overrides (A1 — cascata exceção vence grade)", () => {
  const nowUtc = new Date("2025-03-01T12:00:00.000Z");

  it("override fechado no dia com appointment coberto pela grade = conflito", () => {
    const conflicts = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "09:00", end_time: "18:00" })],
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-10T17:00:00.000Z", // 14:00 BRT, dentro da grade
          endsAt: "2025-03-10T18:00:00.000Z",
          status: "confirmado",
        },
      ],
      nowUtc,
      timeZone: TZ,
      overrides: [ov({ override_date: "2025-03-10", is_closed: true })],
    });
    expect(conflicts).toHaveLength(1);
  });

  it("override atípico que cobre o appointment = sem conflito (grade estreita não bloqueia)", () => {
    const conflicts = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "09:00", end_time: "12:00" })],
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-10T17:00:00.000Z", // 14:00 BRT, fora da grade 09-12
          endsAt: "2025-03-10T18:00:00.000Z",
          status: "confirmado",
        },
      ],
      nowUtc,
      timeZone: TZ,
      overrides: [
        ov({
          override_date: "2025-03-10",
          is_closed: false,
          start_time: "09:00",
          end_time: "18:00",
        }),
      ],
    });
    expect(conflicts).toEqual([]);
  });

  it("override atípico que não cobre o appointment = conflito", () => {
    const conflicts = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "09:00", end_time: "18:00" })],
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-10T17:00:00.000Z", // 14:00 BRT
          endsAt: "2025-03-10T18:00:00.000Z",
          status: "confirmado",
        },
      ],
      nowUtc,
      timeZone: TZ,
      overrides: [
        ov({
          override_date: "2025-03-10",
          is_closed: false,
          start_time: "09:00",
          end_time: "13:00",
        }),
      ],
    });
    expect(conflicts).toHaveLength(1);
  });

  it("override de outro dia não interfere (grade continua valendo)", () => {
    const conflicts = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "09:00", end_time: "18:00" })],
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-10T17:00:00.000Z",
          endsAt: "2025-03-10T18:00:00.000Z",
          status: "confirmado",
        },
      ],
      nowUtc,
      timeZone: TZ,
      overrides: [ov({ override_date: "2025-03-11", is_closed: true })],
    });
    expect(conflicts).toEqual([]);
  });
});

describe("tabela verdade — vigência/override/break/bordas/DST (A4)", () => {
  it("vigência: fronteiras de início e fim são inclusivas", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })],
      overrides: [],
      scheduleStartDate: "2025-03-10",
      scheduleEndDate: "2025-03-17",
    });
    const statusOf = (date: string) =>
      days.find((d) => d.date === date)?.status;
    expect(statusOf("2025-03-10")).toBe("grade"); // borda inicial (seg)
    expect(statusOf("2025-03-17")).toBe("grade"); // borda final (seg)
    expect(statusOf("2025-03-03")).toBe("fora-vigencia"); // antes do início
    expect(statusOf("2025-03-24")).toBe("fora-vigencia"); // depois do fim
  });

  it("override fechado em dia sem grade = folga (não livre)", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })],
      overrides: [ov({ override_date: "2025-03-15", is_closed: true })], // sáb
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    expect(days.find((d) => d.date === "2025-03-15")?.status).toBe("folga");
  });

  it("atípico em dia sem grade = atípico (exceção cria a janela)", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 1 })],
      overrides: [
        ov({
          override_date: "2025-03-15",
          is_closed: false,
          start_time: "09:00",
          end_time: "13:00",
        }),
      ],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const dia = days.find((d) => d.date === "2025-03-15");
    expect(dia?.status).toBe("atipico");
    expect(dia?.windows[0]?.startTime).toBe("09:00");
  });

  it("mensal == slots no dia atípico (override vence grade nos dois)", () => {
    const atipico = ov({
      override_date: "2025-03-15",
      is_closed: false,
      start_time: "09:00",
      end_time: "13:00",
    });
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [wh({ weekday: 6, start_time: "09:00", end_time: "18:00" })],
      overrides: [atipico],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const slots = generateAvailableSlots({
      day: "2025-03-15",
      timeZone: TZ,
      durationMinutes: 60,
      slotStepMinutes: 60,
      scheduleStartDate: null,
      scheduleEndDate: null,
      workingHours: [wh({ weekday: 6, start_time: "09:00", end_time: "18:00" })],
      override: atipico,
      busy: [],
      nowUtc: PAST,
    });
    const labels = slots.map((s) => s.label);
    expect(labels).toContain("09:00");
    expect(labels).not.toContain("14:00"); // fora da janela atípica
    expect(days.find((d) => d.date === "2025-03-15")?.windows[0]?.endTime).toBe(
      "13:00",
    );
  });

  it("borda de janela: appointment == janela cobre; encostando fora não cobre", () => {
    const base = {
      nowUtc: new Date("2025-03-01T12:00:00.000Z"),
      timeZone: TZ,
    };
    const drafts = [wh({ weekday: 1, start_time: "09:00", end_time: "18:00" })];
    // 09:00–18:00 BRT = 12:00–21:00 UTC em 2025-03-10.
    const run = (startsAt: string, endsAt: string) =>
      findBatchConflicts({
        drafts,
        appointments: [{ id: "a", startsAt, endsAt, status: "confirmado" }],
        ...base,
      });
    expect(run("2025-03-10T12:00:00.000Z", "2025-03-10T21:00:00.000Z")).toEqual(
      [],
    ); // exatamente a janela
    expect(run("2025-03-10T21:00:00.000Z", "2025-03-10T22:00:00.000Z")).toHaveLength(
      1,
    ); // começa no fechamento (18:00 BRT)
    expect(run("2025-03-10T11:00:00.000Z", "2025-03-10T12:00:00.000Z")).toHaveLength(
      1,
    ); // termina na abertura (09:00 BRT)
  });

  it("parede no fuso: 02:30 UTC = 23:30 BRT do dia anterior (domingo, sem grade de seg)", () => {
    const conflicts = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "09:00", end_time: "18:00" })],
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-10T02:30:00.000Z", // 2025-03-09 23:30 BRT (dom)
          endsAt: "2025-03-10T03:30:00.000Z",
          status: "confirmado",
        },
      ],
      nowUtc: new Date("2025-03-01T12:00:00.000Z"),
      timeZone: TZ,
    });
    expect(conflicts).toHaveLength(1); // domingo não está na grade
    expect(conflicts[0]?.date).toBe("2025-03-09");
  });

  it("agora: appointment exatamente em nowUtc é futuro; 1s antes é passado", () => {
    const nowUtc = new Date("2025-03-10T12:00:00.000Z");
    const base = { nowUtc, timeZone: TZ };
    const drafts = [wh({ weekday: 1, start_time: "09:00", end_time: "18:00" })];
    const atNow = findBatchConflicts({
      drafts,
      appointments: [
        {
          id: "a",
          startsAt: "2025-03-10T12:00:00.000Z", // 09:00 BRT, na janela
          endsAt: "2025-03-10T13:00:00.000Z",
          status: "confirmado",
        },
      ],
      ...base,
    });
    expect(atNow).toEqual([]); // futuro (não pulado), mas coberto pela grade
    const justBefore = findBatchConflicts({
      drafts: [wh({ weekday: 1, start_time: "14:00", end_time: "18:00" })],
      appointments: [
        {
          id: "a",
          startsAt: "2025-03-10T11:59:59.000Z", // 08:59:59 BRT, fora da grade
          endsAt: "2025-03-10T13:00:00.000Z",
          status: "confirmado",
        },
      ],
      ...base,
    });
    expect(justBefore).toEqual([]); // passado preservado, nunca bloqueia
  });
});

describe("isRetroactiveEditBlocked", () => {
  it("vigência nova no passado bloqueia; futura não", () => {
    expect(
      isRetroactiveEditBlocked({
        scheduleStartDate: "2025-01-10",
        today: "2025-03-01",
      }),
    ).toBe(true);
    expect(
      isRetroactiveEditBlocked({
        scheduleStartDate: "2025-04-01",
        today: "2025-03-01",
      }),
    ).toBe(false);
    expect(isRetroactiveEditBlocked({ scheduleStartDate: null })).toBe(false);
  });
});
