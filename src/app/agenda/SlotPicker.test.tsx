// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlotPicker } from "@/app/agenda/SlotPicker";
import type { AvailableSlot } from "@/lib/scheduling-slots";

afterEach(cleanup);

function slot(label: string): AvailableSlot {
  return {
    startUtc: `2026-11-10T${label}:00.000Z`,
    endUtc: `2026-11-10T${label}:00.000Z`,
    label,
  };
}

describe("SlotPicker por turnos", () => {
  it("agrupa slots em Manhã / Tarde / Noite", () => {
    render(
      <SlotPicker
        slots={[slot("08:00"), slot("13:00"), slot("19:30")]}
        isLoading={false}
        isEnabled
        emptyReason={null}
        value=""
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Manhã")).toBeDefined();
    expect(screen.getByText("Tarde")).toBeDefined();
    expect(screen.getByText("Noite")).toBeDefined();
  });

  it("omite turnos vazios", () => {
    render(
      <SlotPicker
        slots={[slot("09:00")]}
        isLoading={false}
        isEnabled
        emptyReason={null}
        value=""
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("Tarde")).toBeNull();
    expect(screen.queryByText("Noite")).toBeNull();
  });

  it("anuncia turno + horário e mantém aria-checked", () => {
    const onSelect = vi.fn();
    render(
      <SlotPicker
        slots={[slot("09:30"), slot("14:00")]}
        isLoading={false}
        isEnabled
        emptyReason={null}
        value="14:00"
        onSelect={onSelect}
      />,
    );
    const chips = screen.getAllByRole("radio");
    expect(chips).toHaveLength(2);
    expect(chips[0].getAttribute("aria-checked")).toBe("false");
    expect(chips[1].getAttribute("aria-checked")).toBe("true");
    // Leitor anuncia turno junto do horário.
    expect(chips[1].getAttribute("aria-label")).toMatch(/tarde/i);
    expect(chips[1].getAttribute("aria-label")).toContain("14:00");

    fireEvent.click(chips[0]);
    expect(onSelect).toHaveBeenCalledWith("09:30");
  });

  it("mantém estados-guia e vazio", () => {
    const { unmount } = render(
      <SlotPicker
        slots={[]}
        isLoading={false}
        isEnabled={false}
        emptyReason={null}
        value=""
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Escolha profissional, serviço e data/),
    ).toBeDefined();
    unmount();

    render(
      <SlotPicker
        slots={[]}
        isLoading={false}
        isEnabled
        emptyReason="sem-slots"
        value=""
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nenhum horário livre/)).toBeDefined();
  });
});
