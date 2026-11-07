import { describe, expect, it } from "vitest";

import {
  applyPreset,
  copyDayToTargets,
  SCHEDULE_PRESETS,
  countChangedDays,
} from "@/app/config/profissionais/horarios/schedulePresets";

import type { WorkingHoursDayInput } from "@/lib/validations/catalog";

const empty = (): WorkingHoursDayInput => ({
  weekday: 0,
  enabled: false,
  startTime: undefined,
  endTime: undefined,
  hasBreak: false,
  breakStart: undefined,
  breakEnd: undefined,
});

function week() {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ...empty(), weekday }));
}

describe("schedulePresets", () => {
  it("preset Seg–Sex 08–18 habilita só dias úteis e deixa sáb/dom livres", () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === "seg-sex-08-18")!;
    const next = applyPreset(week(), preset);
    const byWeekday = new Map(next.map((d) => [d.weekday, d]));
    for (const w of [1, 2, 3, 4, 5]) {
      expect(byWeekday.get(w)?.enabled).toBe(true);
      expect(byWeekday.get(w)?.startTime).toBe("08:00");
      expect(byWeekday.get(w)?.endTime).toBe("18:00");
    }
    expect(byWeekday.get(6)?.enabled).toBe(false);
    expect(byWeekday.get(0)?.enabled).toBe(false);
  });

  it("preset com almoço grava break 12–13 nos dias úteis", () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === "seg-sex-almoco")!;
    const next = applyPreset(week(), preset);
    expect(next.find((d) => d.weekday === 1)).toMatchObject({
      enabled: true,
      startTime: "08:00",
      endTime: "18:00",
      hasBreak: true,
      breakStart: "12:00",
      breakEnd: "13:00",
    });
  });

  it("preset fim de semana habilita sáb 09–14", () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === "fds-sab-09-14")!;
    const next = applyPreset(week(), preset);
    expect(next.find((d) => d.weekday === 6)).toMatchObject({
      enabled: true,
      startTime: "09:00",
      endTime: "14:00",
    });
    expect(next.find((d) => d.weekday === 0)?.enabled).toBe(false);
  });

  it("copiar dia→selecionados copia janela e intervalo", () => {
    const days = week();
    days[1] = {
      ...days[1],
      weekday: 1,
      enabled: true,
      startTime: "09:00",
      endTime: "17:00",
      hasBreak: true,
      breakStart: "12:00",
      breakEnd: "13:00",
    };
    const next = copyDayToTargets(days, 1, [2, 3]);
    expect(next.find((d) => d.weekday === 2)).toMatchObject({
      enabled: true,
      startTime: "09:00",
      endTime: "17:00",
      hasBreak: true,
    });
    expect(next.find((d) => d.weekday === 3)?.startTime).toBe("09:00");
    expect(next.find((d) => d.weekday === 4)?.enabled).toBe(false);
  });

  it("countChangedDays conta dias diferentes da grade atual", () => {
    const current = week();
    current[1] = {
      ...current[1],
      weekday: 1,
      enabled: true,
      startTime: "09:00",
      endTime: "18:00",
    };
    const next = week();
    next[1] = { ...current[1] };
    next[2] = {
      ...next[2],
      weekday: 2,
      enabled: true,
      startTime: "09:00",
      endTime: "18:00",
    };
    expect(countChangedDays(current, next)).toBe(1);
  });
});
