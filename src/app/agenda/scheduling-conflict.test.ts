import { describe, expect, it } from "vitest";

import { hasLocalConflict } from "@/app/agenda/scheduling-conflict";
import type { AppointmentWithRelations } from "@/types/domain";

function item(
  overrides: Partial<AppointmentWithRelations> = {},
): AppointmentWithRelations {
  return {
    id: "ap-1",
    professional_id: "p-1",
    starts_at: "2026-11-10T12:00:00.000Z",
    ends_at: "2026-11-10T13:00:00.000Z",
    status: "pendente",
    ...overrides,
  } as AppointmentWithRelations;
}

const START = new Date("2026-11-10T12:30:00.000Z");
const END = new Date("2026-11-10T13:30:00.000Z");

describe("hasLocalConflict", () => {
  it("detecta sobreposição do mesmo profissional", () => {
    expect(hasLocalConflict([item()], null, "p-1", START, END)).toBe(true);
  });

  it("ignora profissionais diferentes", () => {
    expect(hasLocalConflict([item()], null, "p-2", START, END)).toBe(false);
  });

  it("ignora o próprio agendamento em edição", () => {
    expect(hasLocalConflict([item({ id: "ap-1" })], "ap-1", "p-1", START, END)).toBe(
      false,
    );
  });

  it("ignora status inativos (cancelado/concluido/nao_compareceu)", () => {
    for (const status of ["cancelado", "concluido", "nao_compareceu"] as const) {
      expect(
        hasLocalConflict([item({ status })], null, "p-1", START, END),
      ).toBe(false);
    }
  });

  it("permite encosto exato (fim == início)", () => {
    const touch = new Date("2026-11-10T13:00:00.000Z");
    const after = new Date("2026-11-10T14:00:00.000Z");
    expect(hasLocalConflict([item()], null, "p-1", touch, after)).toBe(false);
  });
});
