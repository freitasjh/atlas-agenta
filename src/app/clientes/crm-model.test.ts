import { describe, expect, it } from "vitest";

import {
  canCreateNote,
  canViewNote,
  filterCrmCustomers,
  type CrmCustomerRow,
  type CustomerNote,
} from "@/app/clientes/crm-model";

function note(overrides: Partial<CustomerNote>): CustomerNote {
  return {
    id: "n1",
    customerId: "c1",
    authorRole: "receptionist",
    visibility: "operational",
    appointmentId: null,
    appointmentProfessionalId: null,
    body: "Prefere manhã.",
    createdAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("crm-model — visibilidade de notas por papel (RF-28)", () => {
  it("admin lê todas as visibilidades", () => {
    expect(canViewNote(note({ visibility: "operational" }), "admin")).toBe(true);
    expect(canViewNote(note({ visibility: "admin" }), "admin")).toBe(true);
    expect(
      canViewNote(note({ visibility: "appointment", appointmentId: "a1" }), "admin"),
    ).toBe(true);
  });

  it("receptionist lê e cria apenas operacionais", () => {
    expect(canViewNote(note({ visibility: "operational" }), "receptionist")).toBe(true);
    expect(canViewNote(note({ visibility: "admin" }), "receptionist")).toBe(false);
    expect(
      canViewNote(note({ visibility: "appointment", appointmentId: "a1" }), "receptionist"),
    ).toBe(false);
    expect(canCreateNote("receptionist")).toBe(true);
    expect(canCreateNote("admin")).toBe(true);
  });

  it("professional vê apenas notas do próprio atendimento", () => {
    const own = note({ visibility: "appointment", appointmentId: "a1" });
    expect(canViewNote(own, "professional", { professionalId: "p1", appointmentProfessionalId: "p1" })).toBe(true);
    expect(canViewNote(own, "professional", { professionalId: "p1", appointmentProfessionalId: "p9" })).toBe(false);
    expect(canViewNote(note({ visibility: "operational" }), "professional")).toBe(false);
    expect(canCreateNote("professional")).toBe(false);
  });
});

describe("crm-model — filtros (RF-29)", () => {
  const rows: CrmCustomerRow[] = [
    { id: "c1", name: "Ana", tags: ["vip"], segment: "recorrente", noShowCount: 3 },
    { id: "c2", name: "Bia", tags: ["inativo"], segment: "novo", noShowCount: 0 },
    { id: "c3", name: "Cid", tags: ["vip", "inativo"], segment: "recorrente", noShowCount: 1 },
  ];

  it("filtra por tag", () => {
    expect(filterCrmCustomers(rows, { tag: "vip" }).map((r) => r.id)).toEqual(["c1", "c3"]);
  });

  it("filtra por segmento", () => {
    expect(filterCrmCustomers(rows, { segment: "novo" }).map((r) => r.id)).toEqual(["c2"]);
  });

  it("filtra por no-show mínimo", () => {
    expect(filterCrmCustomers(rows, { minNoShow: 2 }).map((r) => r.id)).toEqual(["c1"]);
  });

  it("combina filtros", () => {
    expect(
      filterCrmCustomers(rows, { tag: "vip", segment: "recorrente", minNoShow: 1 }).map((r) => r.id),
    ).toEqual(["c1", "c3"]);
  });

  it("sem filtros retorna tudo", () => {
    expect(filterCrmCustomers(rows, {})).toHaveLength(3);
  });
});
