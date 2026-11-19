import { describe, expect, it } from "vitest";

import {
  INACTIVE_APPOINTMENT_STATUSES,
  isActiveAppointmentStatus,
  isCountedAppointmentStatus,
  NON_COUNTED_APPOINTMENT_STATUSES,
} from "@/lib/scheduling-status";
import type { AppointmentStatus } from "@/types/domain";

const ACTIVE: AppointmentStatus[] = ["pendente", "confirmado", "em_atendimento"];
const INACTIVE: AppointmentStatus[] = ["cancelado", "nao_compareceu", "concluido"];

describe("isActiveAppointmentStatus", () => {
  it.each(ACTIVE)("status ativo ocupa o horário: %s", (status) => {
    expect(isActiveAppointmentStatus(status)).toBe(true);
  });

  it.each(INACTIVE)("status inativo libera o horário: %s", (status) => {
    expect(isActiveAppointmentStatus(status)).toBe(false);
  });

  it("espelha INACTIVE_APPOINTMENT_STATUSES", () => {
    for (const status of INACTIVE_APPOINTMENT_STATUSES) {
      expect(isActiveAppointmentStatus(status)).toBe(false);
    }
  });
});

describe("isCountedAppointmentStatus", () => {
  it.each([...ACTIVE, "concluido"] as AppointmentStatus[])(
    "conta como agendamento do dia: %s",
    (status) => {
      expect(isCountedAppointmentStatus(status)).toBe(true);
    },
  );

  it.each(["cancelado", "nao_compareceu"] as AppointmentStatus[])(
    "não conta (nunca representou atendimento): %s",
    (status) => {
      expect(isCountedAppointmentStatus(status)).toBe(false);
    },
  );

  it("concluido conta mas não ocupa — evita badge 0 em mês só com histórico", () => {
    expect(isCountedAppointmentStatus("concluido")).toBe(true);
    expect(isActiveAppointmentStatus("concluido")).toBe(false);
  });

  it("espelha NON_COUNTED_APPOINTMENT_STATUSES", () => {
    for (const status of NON_COUNTED_APPOINTMENT_STATUSES) {
      expect(isCountedAppointmentStatus(status)).toBe(false);
    }
  });
});
