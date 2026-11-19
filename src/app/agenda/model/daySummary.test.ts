import { describe, expect, it } from "vitest";
import {
  computeDaySummary,
  type DaySummaryInput,
} from "@/app/agenda/model/daySummary";

function appt(
  overrides: Partial<DaySummaryInput> & { id: string },
): DaySummaryInput {
  return {
    status: "confirmado",
    professional_id: "p1",
    price_cents: 5000,
    customers: { name: "Cli", whatsapp_opt_in: true },
    ...overrides,
  };
}

describe("computeDaySummary", () => {
  it("10 agendados / capacidade 20 → 50% + '10 de 20'", () => {
    const appts = Array.from({ length: 10 }, (_, i) =>
      appt({ id: `a${i}`, status: "confirmado" }),
    );
    const s = computeDaySummary(appts, 20);
    expect(s.horariosOcupados).toBe(10);
    expect(s.capacidade).toBe(20);
    expect(s.ocupacaoPct).toBe(50);
    expect(s.numAtendimentos).toBe(10);
  });

  it("previsto = soma price_cents dos não-cancelados (inclui nao_compareceu)", () => {
    const appts = [
      appt({ id: "a1", status: "pendente", price_cents: 1000 }),
      appt({ id: "a2", status: "confirmado", price_cents: 2000 }),
      appt({ id: "a3", status: "em_atendimento", price_cents: 3000 }),
      appt({ id: "a4", status: "concluido", price_cents: 4000 }),
      appt({ id: "a5", status: "nao_compareceu", price_cents: 5000 }),
      appt({ id: "a6", status: "cancelado", price_cents: 9999 }),
    ];
    const s = computeDaySummary(appts, 20);
    expect(s.previstoCents).toBe(15000);
  });

  it("cancelado excluído da ocupação e do previsto; price_cents null = 0", () => {
    const appts = [
      appt({ id: "a1", status: "confirmado", price_cents: 2000 }),
      appt({ id: "a2", status: "cancelado", price_cents: 8000 }),
      appt({
        id: "a3",
        status: "pendente",
        price_cents: null,
      }),
    ];
    const s = computeDaySummary(appts, 10);
    expect(s.horariosOcupados).toBe(2);
    expect(s.previstoCents).toBe(2000);
  });

  it("aConfirmar = conta pendente", () => {
    const appts = [
      appt({ id: "a1", status: "pendente" }),
      appt({ id: "a2", status: "pendente" }),
      appt({ id: "a3", status: "confirmado" }),
    ];
    expect(computeDaySummary(appts, 10).aConfirmar).toBe(2);
  });

  it("risco = sem opt-in do dia + histórico nao_compareceu 7d", () => {
    const appts = [
      appt({
        id: "a1",
        status: "pendente",
        customers: { name: "A", whatsapp_opt_in: false },
      }),
      appt({ id: "a2", status: "pendente", customers: null }),
      appt({
        id: "a3",
        status: "confirmado",
        customers: { name: "C", whatsapp_opt_in: true },
      }),
    ];
    const history = [
      appt({ id: "h1", status: "nao_compareceu" }),
      appt({ id: "h2", status: "concluido" }),
    ];
    const s = computeDaySummary(appts, 10, { history });
    // 2 sem opt-in (false + null) + 1 nao_compareceu no histórico
    expect(s.riscoNoShow).toBe(3);
  });

  it("risco filtra histórico por professional quando informado", () => {
    const appts = [appt({ id: "a1", status: "pendente" })];
    const history = [
      appt({ id: "h1", status: "nao_compareceu", professional_id: "p1" }),
      appt({ id: "h2", status: "nao_compareceu", professional_id: "p9" }),
    ];
    const s = computeDaySummary(appts, 10, {
      history,
      professionalId: "p1",
    });
    // 0 sem opt-in + 1 nao_compareceu do mesmo profissional
    expect(s.riscoNoShow).toBe(1);
  });

  it("sem capacidade → ocupacaoPct null (degrada para 'N agendados')", () => {
    const appts = [appt({ id: "a1", status: "confirmado" })];
    const s = computeDaySummary(appts, null);
    expect(s.ocupacaoPct).toBeNull();
    expect(s.horariosOcupados).toBe(1);
  });
});
