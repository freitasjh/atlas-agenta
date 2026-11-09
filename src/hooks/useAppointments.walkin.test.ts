import { describe, expect, it } from "vitest";

import { appointmentRowSchema } from "@/hooks/useAppointments";

/**
 * ADR-21 (PDV balcão 1R): `origin` + `customer_id` nullable.
 * - walk-in anônimo (`customer_id: null`, `origin: 'walk_in'`) valida.
 * - agendado com cliente valida (regressão).
 * - linha legada sem `origin` normaliza para `'agendado'` (backfill do banco).
 */
const baseRow = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant_id: "22222222-2222-2222-2222-222222222222",
  customer_id: "33333333-3333-3333-3333-333333333333",
  professional_id: "44444444-4444-4444-4444-444444444444",
  service_id: "55555555-5555-5555-5555-555555555555",
  combo_id: null,
  starts_at: "2026-11-09T15:00:00.000Z",
  ends_at: "2026-11-09T15:30:00.000Z",
  price_cents: 5000,
  status: "concluido",
  confirmed_at: null,
  confirmed_via: null,
  created_at: "2026-11-09T14:55:00.000Z",
  customers: { name: "Ana", whatsapp_opt_in: true },
  services: { name: "Corte", duration_minutes: 30, price_cents: 5000 },
  combos: null,
  professionals: { name: "Beto" },
  appointment_commissions: null,
} as const;

describe("appointmentRowSchema — walk-in (ADR-21)", () => {
  it("aceita walk-in anônimo com customer_id nulo", () => {
    const parsed = appointmentRowSchema.parse({
      ...baseRow,
      origin: "walk_in",
      customer_id: null,
      customers: null,
    });
    expect(parsed.origin).toBe("walk_in");
    expect(parsed.customer_id).toBeNull();
  });

  it("aceita agendado com cliente (regressão)", () => {
    const parsed = appointmentRowSchema.parse({ ...baseRow, origin: "agendado" });
    expect(parsed.origin).toBe("agendado");
    expect(parsed.customer_id).toBe(baseRow.customer_id);
  });

  it("normaliza linha legada sem origin para agendado", () => {
    const { origin: _origin, ...legado } = { ...baseRow, origin: "agendado" };
    void _origin;
    const parsed = appointmentRowSchema.parse(legado);
    expect(parsed.origin).toBe("agendado");
  });
});
