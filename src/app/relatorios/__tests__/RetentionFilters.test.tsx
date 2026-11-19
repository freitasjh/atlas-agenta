// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RetentionFilters } from "@/app/relatorios/RetentionFilters";
import type { PeriodPreset } from "@/app/relatorios/PeriodFilter";

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({
    data: [{ id: "p1", name: "Ana" }],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({
    data: [{ id: "s1", name: "Corte" }],
    isLoading: false,
    isError: false,
  }),
}));

function Harness() {
  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const [professionalId, setProfessionalId] = useState("todos");
  const [serviceId, setServiceId] = useState("todos");
  return createElement(RetentionFilters, {
    idPrefix: "teste",
    preset,
    start: "2026-10-01",
    end: "2026-10-31",
    onPresetChange: setPreset,
    onStartChange: () => {},
    onEndChange: () => {},
    professionalId,
    onProfessionalChange: setProfessionalId,
    serviceId,
    onServiceChange: setServiceId,
  });
}

function renderFilters() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return render(createElement(MemoryRouter, null, createElement(wrapper, null, createElement(Harness))));
}

afterEach(() => cleanup());

describe("RetentionFilters (ADR-17)", () => {
  it("troca de preset personalizado habilita inputs de data", () => {
    renderFilters();
    const inicio = screen.getByLabelText("Início") as HTMLInputElement;
    expect(inicio.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
    expect((screen.getByLabelText("Início") as HTMLInputElement).disabled).toBe(false);
  });

  it("lista profissionais e serviços do catálogo", () => {
    renderFilters();
    expect(screen.getByLabelText("Filtrar por profissional")).toBeTruthy();
    expect(screen.getByLabelText("Filtrar por serviço")).toBeTruthy();
  });
});
