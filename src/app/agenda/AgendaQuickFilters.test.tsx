// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgendaQuickFilters } from "@/app/agenda/AgendaQuickFilters";
import type { AgendaView } from "@/app/agenda/AgendaViewToggle";

function renderQuick(overrides: Partial<Parameters<typeof AgendaQuickFilters>[0]> = {}) {
  const props = {
    day: "2026-11-10",
    todayIso: "2026-11-10",
    tomorrowIso: "2026-11-11",
    weekAtiva: false,
    onSelectDay: vi.fn(),
    onSelectWeek: vi.fn(),
    aConfirmarAtivo: false,
    onToggleAConfirmar: vi.fn(),
    view: "lista" as AgendaView,
    onViewChange: vi.fn(),
    ...overrides,
  };
  render(<AgendaQuickFilters {...props} />);
  return props;
}

afterEach(cleanup);

describe("AgendaQuickFilters (ADR-02)", () => {
  it("Hoje ativo (aria-pressed) quando day === todayIso; clique vai para hoje", () => {
    const props = renderQuick();
    expect(screen.getByRole("button", { name: "Hoje" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    expect(props.onSelectDay).toHaveBeenCalledWith("2026-11-10");
  });

  it("Amanhã seleciona o dia seguinte", () => {
    const props = renderQuick({ day: "2026-11-11" });
    expect(
      screen.getByRole("button", { name: "Amanhã" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Amanhã" }));
    expect(props.onSelectDay).toHaveBeenCalledWith("2026-11-11");
  });

  it("'Esta semana' chama onSelectWeek e reflete weekAtiva", () => {
    const props = renderQuick({ weekAtiva: true });
    const week = screen.getByRole("button", { name: "Esta semana" });
    expect(week.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(week);
    expect(props.onSelectWeek).toHaveBeenCalledTimes(1);
  });

  it("'A confirmar' alterna com aria-pressed", () => {
    const props = renderQuick({ aConfirmarAtivo: true });
    const toggle = screen.getByRole("button", { name: "A confirmar" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(props.onToggleAConfirmar).toHaveBeenCalledTimes(1);
  });

  it("embute o view toggle existente (Lista/Dia/Semana)", () => {
    const props = renderQuick();
    fireEvent.click(screen.getByRole("button", { name: "Dia" }));
    expect(props.onViewChange).toHaveBeenCalledWith("dia");
  });
});
