import { describe, expect, it } from "vitest";

import {
  buildDuplicatePrefill,
  resolveDuplicatePrefill,
  suggestDuplicateSlot,
} from "@/app/agenda/duplicateAppointment";
import type { AppointmentWithRelations } from "@/types/domain";

const TIME_ZONE = "America/Sao_Paulo";
const DAY = "2026-11-10";

function appointment(
  overrides: Partial<AppointmentWithRelations> = {},
): AppointmentWithRelations {
  return {
    id: "ap-1",
    customer_id: "c-1",
    professional_id: "pr-1",
    service_id: "s-1",
    combo_id: null,
    // 09:00–10:00 BRT = 12:00–13:00Z.
    starts_at: "2026-11-10T12:00:00.000Z",
    ends_at: "2026-11-10T13:00:00.000Z",
    price_cents: 10000,
    status: "pendente",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-01T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: false },
    services: { name: "Corte" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
    ...overrides,
  } as unknown as AppointmentWithRelations;
}

describe("suggestDuplicateSlot", () => {
  it("sugere o próximo slot livre de 30min após o original", () => {
    const source = appointment();
    const suggestion = suggestDuplicateSlot({
      appointment: source,
      dayAppointments: [source],
      day: DAY,
      timeZone: TIME_ZONE,
    });
    // Original 09:00–10:00 → próximo livre 10:00, mesma duração (60min).
    expect(suggestion).toEqual({ date: DAY, time: "10:00" });
  });

  it("pula faixas ocupadas pelo mesmo profissional", () => {
    const source = appointment();
    const blocker = appointment({
      id: "ap-2",
      starts_at: "2026-11-10T13:00:00.000Z",
      ends_at: "2026-11-10T14:00:00.000Z",
    });
    const suggestion = suggestDuplicateSlot({
      appointment: source,
      dayAppointments: [source, blocker],
      day: DAY,
      timeZone: TIME_ZONE,
    });
    // 10:00–11:00 ocupado → sugere 11:00.
    expect(suggestion).toEqual({ date: DAY, time: "11:00" });
  });

  it("ignora agendamentos de outro profissional e status inativos", () => {
    const source = appointment();
    const otherPro = appointment({
      id: "ap-3",
      professional_id: "pr-2",
      starts_at: "2026-11-10T13:00:00.000Z",
      ends_at: "2026-11-10T14:00:00.000Z",
    });
    const cancelled = appointment({
      id: "ap-4",
      status: "cancelado",
      starts_at: "2026-11-10T13:00:00.000Z",
      ends_at: "2026-11-10T14:00:00.000Z",
    });
    const suggestion = suggestDuplicateSlot({
      appointment: source,
      dayAppointments: [source, otherPro, cancelled],
      day: DAY,
      timeZone: TIME_ZONE,
    });
    expect(suggestion).toEqual({ date: DAY, time: "10:00" });
  });

  it("retorna null quando o dia está cheio até o limite", () => {
    const source = appointment();
    // Bloqueia 10:00–21:00 com blocos de 1h do mesmo profissional.
    const blockers = Array.from({ length: 11 }, (_, index) => {
      const startHourUtc = 13 + index;
      const pad = (n: number) => n.toString().padStart(2, "0");
      return appointment({
        id: `block-${index}`,
        starts_at: `2026-11-10T${pad(startHourUtc)}:00:00.000Z`,
        ends_at: `2026-11-10T${pad(startHourUtc + 1)}:00:00.000Z`,
      });
    });
    const suggestion = suggestDuplicateSlot({
      appointment: source,
      dayAppointments: [source, ...blockers],
      day: DAY,
      timeZone: TIME_ZONE,
    });
    expect(suggestion).toBeNull();
  });
});

describe("buildDuplicatePrefill", () => {
  it("pré-preenche sem copiar pagamento, comprovante ou id", () => {
    const source = appointment();
    const prefill = buildDuplicatePrefill(source, { date: DAY, time: "10:00" });
    expect(prefill).toEqual({
      professionalId: "pr-1",
      time: "10:00",
      customerId: "c-1",
      serviceId: "s-1",
      comboId: undefined,
    });
    // Nunca vaza campo financeiro/identidade para o formulário.
    expect(JSON.stringify(prefill)).not.toMatch(
      /payment|comprovante|commission|price_cents|appointment_payments|charges/i,
    );
    expect("id" in prefill).toBe(false);
  });

  it("leva o combo quando o original é pacote", () => {
    const source = appointment({
      service_id: null,
      combo_id: "combo-9",
    });
    const prefill = buildDuplicatePrefill(source, { date: DAY, time: "10:00" });
    expect(prefill.comboId).toBe("combo-9");
    expect(prefill.serviceId).toBeUndefined();
  });
});

describe("resolveDuplicatePrefill", () => {
  it("quando há sugestão, usa o slot sugerido", () => {
    const source = appointment();
    const prefill = resolveDuplicatePrefill(source, { date: DAY, time: "10:00" });
    expect(prefill.time).toBe("10:00");
    expect(prefill.professionalId).toBe("pr-1");
  });

  it("quando dia cheio (sugestão null), abre com time vazio (SlotPicker sem-slots)", () => {
    const source = appointment();
    const prefill = resolveDuplicatePrefill(source, null);
    expect(prefill.time).toBe("");
    expect(prefill.professionalId).toBe("pr-1");
    expect(prefill.customerId).toBe("c-1");
    expect(prefill.serviceId).toBe("s-1");
  });
});
