// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  filterWaitlistEntries,
  findDuplicateEntry,
  formatCountdown,
  isActiveStatus,
  isOfferExpired,
  priorityLabel,
  remainingMs,
  sortWaitlistEntries,
  type WaitlistEntry,
  type WaitlistEntryView,
} from "@/app/lista-espera/model";

function entry(overrides: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id: "e1",
    tenant_id: "t1",
    customer_id: "c1",
    service_id: "s1",
    professional_id: "p1",
    desired_start_from: "2026-02-01T00:00:00.000Z",
    desired_start_to: "2026-02-28T00:00:00.000Z",
    priority: 1,
    status: "aguardando",
    offered_slot_start: null,
    offered_slot_end: null,
    offered_professional_id: null,
    offer_expires_at: null,
    expires_at: null,
    created_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function view(overrides: Partial<WaitlistEntryView> = {}): WaitlistEntryView {
  return {
    ...entry(),
    customerName: "Maria Silva",
    serviceName: "Corte",
    professionalName: "João",
    ...overrides,
  };
}

describe("waitlist model", () => {
  it("ordena por priority desc e created_at asc", () => {
    const a = entry({ id: "a", priority: 1, created_at: "2026-01-01T09:00:00.000Z" });
    const b = entry({ id: "b", priority: 3, created_at: "2026-01-01T11:00:00.000Z" });
    const c = entry({ id: "c", priority: 3, created_at: "2026-01-01T08:00:00.000Z" });
    expect(sortWaitlistEntries([a, b, c]).map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("filtra por busca, status, serviço e profissional", () => {
    const entries = [
      view({ id: "1", customerName: "Maria Silva", status: "aguardando", service_id: "s1", professional_id: "p1" }),
      view({ id: "2", customerName: "Ana Souza", status: "ofertado", service_id: "s2", professional_id: "p2" }),
    ];
    expect(
      filterWaitlistEntries(entries, { search: "maria", status: "todas", serviceId: "todos", professionalId: "todos" }).map((e) => e.id),
    ).toEqual(["1"]);
    expect(
      filterWaitlistEntries(entries, { search: "", status: "ofertado", serviceId: "todos", professionalId: "todos" }).map((e) => e.id),
    ).toEqual(["2"]);
    expect(
      filterWaitlistEntries(entries, { search: "", status: "todas", serviceId: "s2", professionalId: "todos" }).map((e) => e.id),
    ).toEqual(["2"]);
    expect(
      filterWaitlistEntries(entries, { search: "", status: "todas", serviceId: "todos", professionalId: "p1" }).map((e) => e.id),
    ).toEqual(["1"]);
  });

  it("idempotência: encontra duplicata ativa com mesma chave (null casa com null)", () => {
    const active = entry({ id: "dup", customer_id: "c1", service_id: "s1", professional_id: "p1" });
    const done = entry({ id: "done", customer_id: "c1", service_id: "s1", professional_id: "p1", status: "atendido" });
    const key = {
      customer_id: "c1",
      service_id: "s1",
      professional_id: "p1",
      desired_start_from: "2026-02-01T00:00:00.000Z",
      desired_start_to: "2026-02-28T00:00:00.000Z",
    };
    expect(findDuplicateEntry([done], key)).toBeNull();
    expect(findDuplicateEntry([active], key)?.id).toBe("dup");
    expect(findDuplicateEntry([active], { ...key, customer_id: "c2" })).toBeNull();
  });

  it("countdown: remainingMs nunca negativo, formato MM:SS", () => {
    const now = new Date("2026-01-01T10:00:00.000Z").getTime();
    expect(remainingMs("2026-01-01T10:05:00.000Z", now)).toBe(5 * 60 * 1000);
    expect(remainingMs("2026-01-01T09:00:00.000Z", now)).toBe(0);
    expect(formatCountdown(5 * 60 * 1000)).toBe("05:00");
    expect(formatCountdown(90 * 1000)).toBe("01:30");
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("oferta expira quando o countdown zera", () => {
    const now = new Date("2026-01-01T10:00:00.000Z").getTime();
    expect(isOfferExpired(null, now)).toBe(false);
    expect(isOfferExpired("2026-01-01T10:05:00.000Z", now)).toBe(false);
    expect(isOfferExpired("2026-01-01T09:59:59.000Z", now)).toBe(true);
  });

  it("status ativos e rótulos de prioridade", () => {
    expect(isActiveStatus("aguardando")).toBe(true);
    expect(isActiveStatus("ofertado")).toBe(true);
    expect(isActiveStatus("confirmado")).toBe(false);
    expect(isActiveStatus("cancelado")).toBe(false);
    expect(priorityLabel(3)).toBe("alta");
    expect(priorityLabel(2)).toBe("normal");
    expect(priorityLabel(1)).toBe("baixa");
  });
});
