// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgendaCalendarWeek } from "@/app/agenda/AgendaCalendarWeek";
import type {
  AppointmentWithRelations,
  Professional,
  WorkingHour,
} from "@/types/domain";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TIME_ZONE = "America/Sao_Paulo";
const DAY = "2026-11-10"; // terça-feira (weekday 2).
const TODAY = "2026-11-10";

const PROFESSIONALS = [
  { id: "pr-1", name: "Bia" },
  { id: "pr-2", name: "Cris" },
  { id: "pr-3", name: "Duda" },
  { id: "pr-4", name: "Elis" },
] as unknown as Professional[];

function appointment(
  overrides: Partial<AppointmentWithRelations> & { id: string },
): AppointmentWithRelations {
  return {
    customer_id: "c-1",
    professional_id: "pr-1",
    service_id: "s-1",
    combo_id: null,
    starts_at: "2026-11-10T12:00:00.000Z",
    ends_at: "2026-11-10T13:00:00.000Z",
    price_cents: 10000,
    status: "confirmado",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-01T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: true },
    services: { name: "Corte" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
    ...overrides,
  } as unknown as AppointmentWithRelations;
}

function renderWeek(
  overrides: Partial<Parameters<typeof AgendaCalendarWeek>[0]> = {},
) {
  const props: Parameters<typeof AgendaCalendarWeek>[0] = {
    day: DAY,
    timeZone: TIME_ZONE,
    appointments: [],
    todayIso: TODAY,
    onSelectDay: () => {},
    onOpenAppointment: () => {},
    ...overrides,
  };
  return render(<AgendaCalendarWeek {...props} />);
}

describe("AgendaCalendarWeek com ocupação (ADR-05)", () => {
  it("exibe % por dia (texto + barra, nunca só cor)", () => {
    renderWeek({
      appointments: [
        appointment({ id: "a1", starts_at: "2026-11-10T12:00:00.000Z" }),
        appointment({
          id: "a2",
          professional_id: "pr-1",
          starts_at: "2026-11-10T14:00:00.000Z",
        }),
      ],
      professionals: PROFESSIONALS.slice(0, 1),
      // Grade 08:00–18:00 na terça → 20 slots; 2 ocupados → 10%.
      workingHours: [
        {
          professional_id: "pr-1",
          weekday: 2,
          start_time: "08:00",
          end_time: "18:00",
        },
      ] as unknown as WorkingHour[],
    });
    const headers = screen.getAllByTestId("week-day-occupancy-2026-11-10");
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.textContent).toContain("10%");
      expect(header.textContent).toContain("2 de 20");
    }
    const bar = headers[0].querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-valuenow")).toBe("10");
  });

  it("≤3 profissionais → grade agrupada por profissional", () => {
    renderWeek({
      appointments: [
        appointment({ id: "a1", starts_at: "2026-11-10T12:00:00.000Z" }),
        appointment({
          id: "a2",
          professional_id: "pr-2",
          starts_at: "2026-11-10T14:00:00.000Z",
        }),
      ],
      professionals: PROFESSIONALS.slice(0, 2),
      workingHours: [],
    });
    expect(screen.getAllByTestId("week-grade-pr-1").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("week-grade-pr-2").length).toBeGreaterThan(0);
  });

  it(">3 profissionais → modo cards (sem subdivisão por profissional)", () => {
    renderWeek({
      appointments: [
        appointment({ id: "a1", starts_at: "2026-11-10T12:00:00.000Z" }),
        appointment({
          id: "a2",
          professional_id: "pr-2",
          starts_at: "2026-11-10T14:00:00.000Z",
        }),
        appointment({
          id: "a3",
          professional_id: "pr-3",
          starts_at: "2026-11-10T15:00:00.000Z",
        }),
        appointment({
          id: "a4",
          professional_id: "pr-4",
          starts_at: "2026-11-10T16:00:00.000Z",
        }),
      ],
      professionals: PROFESSIONALS,
      workingHours: [],
    });
    // Blocos continuam listados…
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
    // …mas sem lanes por profissional.
    expect(screen.queryAllByTestId("week-grade-pr-1")).toHaveLength(0);
    expect(screen.queryAllByTestId("week-grade-pr-2")).toHaveLength(0);
    // …e o % do dia segue visível.
    const dayHeaders = screen.getAllByTestId("week-day-occupancy-2026-11-10");
    expect(dayHeaders.length).toBeGreaterThan(0);
    for (const header of dayHeaders) {
      expect(header.textContent).toContain("%");
    }
  });

  it("sem grade → denominador estimado 08–18 com apoio 'estimado'", () => {
    renderWeek({
      appointments: [
        appointment({ id: "a1", starts_at: "2026-11-10T12:00:00.000Z" }),
      ],
      professionals: PROFESSIONALS.slice(0, 1),
      workingHours: [],
    });
    const headersEstimado = screen.getAllByTestId("week-day-occupancy-2026-11-10");
    // 1 ocupado / 20 estimados → 5%.
    expect(headersEstimado.length).toBeGreaterThan(0);
    for (const header of headersEstimado) {
      expect(header.textContent).toContain("5%");
      expect(header.textContent).toContain("estimado");
    }
  });

  it("mobile mantém 1 coluna navegável com % do dia em foco", () => {
    renderWeek({
      appointments: [
        appointment({ id: "a1", starts_at: "2026-11-10T12:00:00.000Z" }),
      ],
      professionals: PROFESSIONALS.slice(0, 1),
      workingHours: [],
    });
    expect(
      screen.getByRole("button", { name: "Dia anterior" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Próximo dia" }),
    ).not.toBeNull();
    const mobile = screen
      .getByRole("button", { name: "Dia anterior" })
      .closest("div.rounded-lg");
    expect(mobile?.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it("nunca exibe R$ (receptionist vê % sem valor)", () => {
    const { container } = renderWeek({
      appointments: [
        appointment({
          id: "a1",
          price_cents: 99900,
          starts_at: "2026-11-10T12:00:00.000Z",
        }),
      ],
      professionals: PROFESSIONALS.slice(0, 1),
      workingHours: [],
    });
    expect(container.textContent).not.toMatch(/R\$/);
  });

  it("hoje mantém o realce (peso + cor) na coluna", () => {
    renderWeek({ professionals: PROFESSIONALS.slice(0, 1), workingHours: [] });
    // 2026-11-10 = terça → rótulo "ter 10" (hoje = dia em foco).
    const todayButton = screen.getByRole("button", { name: "ter 10" });
    expect(todayButton.className).toMatch(/text-primary/);
  });
});
