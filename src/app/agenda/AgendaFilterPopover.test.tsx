// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgendaFilterPopover } from "@/app/agenda/AgendaFilterPopover";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    professionals: [{ id: "pr-1", name: "Bia" }],
    services: [{ id: "s-1", name: "Corte" }],
    servicosLabel: "Serviços",
    profissionaisLabel: "Profissionais",
    showProfessional: true,
    professionalId: "",
    serviceId: "",
    status: "" as const,
    paymentPendingOnly: false,
    showPaymentPending: true,
    pendingCount: 2,
    activeCount: 0,
    onChangeProfessional: vi.fn(),
    onChangeService: vi.fn(),
    onChangeStatus: vi.fn(),
    onTogglePaymentPending: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
}

function desktopMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function mobileMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

beforeEach(() => {
  desktopMedia();
});

afterEach(cleanup);

describe("AgendaFilterPopover (ADR-02)", () => {
  it("trigger 'Filtros' exibe badge de contagem quando há filtros ativos", () => {
    render(<AgendaFilterPopover {...baseProps({ activeCount: 3 })} />);
    expect(screen.getByRole("button", { name: /Filtros.*3/ })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("trigger sem badge quando nenhum filtro ativo", () => {
    render(<AgendaFilterPopover {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Filtros" })).toBeTruthy();
  });

  it("abre o diálogo no desktop com profissional, serviço e status", () => {
    render(<AgendaFilterPopover {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Filtros avançados")).toBeTruthy();
    expect(screen.getByLabelText(/Profissionais/)).toBeTruthy();
    expect(screen.getByLabelText(/Serviços/)).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();
  });

  it("'Somente pagamento pendente' aparece com a contagem e alterna", () => {
    const props = baseProps();
    render(<AgendaFilterPopover {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const toggle = screen.getByRole("switch", { name: /pagamento pendente/i });
    expect(screen.getByText("Somente pagamento pendente (2)")).toBeTruthy();
    fireEvent.click(toggle);
    expect(props.onTogglePaymentPending).toHaveBeenCalledTimes(1);
  });

  it("'Limpar tudo' dentro do diálogo zera e fecha", () => {
    const props = baseProps({ activeCount: 2 });
    render(<AgendaFilterPopover {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Filtros.*2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar tudo" }));
    expect(props.onClearAll).toHaveBeenCalledTimes(1);
  });

  it("no mobile abre Sheet inferior (bottom) em vez de diálogo central", () => {
    mobileMedia();
    render(<AgendaFilterPopover {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/bottom/);
  });

  it("oculta o seletor de profissional para quem só vê a própria agenda", () => {
    render(<AgendaFilterPopover {...baseProps({ showProfessional: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.queryByLabelText(/Profissionais/)).toBeNull();
  });

  it("oculta 'pagamento pendente' fora da lista/sem recurso", () => {
    render(<AgendaFilterPopover {...baseProps({ showPaymentPending: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
