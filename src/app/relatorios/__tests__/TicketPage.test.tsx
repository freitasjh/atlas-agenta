// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TicketPage } from "@/app/relatorios/TicketPage";

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  reportState: "success" as "success" | "loading" | "error" | "empty",
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useRetentionReports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRetentionReports")>();
  return {
    ...actual,
    useTicketReport: () => {
      if (mocks.reportState === "loading") {
        return { isLoading: true, isError: false, data: undefined, refetch: mocks.refetch };
      }
      if (mocks.reportState === "error") {
        return { isLoading: false, isError: true, data: undefined, refetch: mocks.refetch };
      }
      if (mocks.reportState === "empty") {
        return { isLoading: false, isError: false, data: [], refetch: mocks.refetch };
      }
      return {
        isLoading: false,
        isError: false,
        refetch: mocks.refetch,
        data: [
          { key: "s1", label: "Corte", ticket_medio_cents: 8000, total_cents: 80000, appointment_count: 10 },
        ],
      };
    },
  };
});

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: mocks.isAdmin }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: [], isLoading: false, isError: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return render(
    createElement(MemoryRouter, null, createElement(wrapper, null, createElement(TicketPage))),
  );
}

beforeEach(() => {
  mocks.isAdmin = true;
  mocks.reportState = "success";
  mocks.refetch.mockClear();
});

afterEach(() => cleanup());

describe("TicketPage (ADR-17)", () => {
  it("renderiza gráfico + tabela com ticket em reais", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Ticket médio" })).toBeTruthy();
    expect(screen.getByText("Corte")).toBeTruthy();
    expect(await screen.findByRole("img", { name: /Gráfico de ticket médio/ })).toBeTruthy();
    expect(screen.getAllByText(/R\$\s80,00/).length).toBeGreaterThanOrEqual(2);
  });

  it("export CSV gera arquivo válido", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((() => "blob:csv") as typeof URL.createObjectURL);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:csv");
    clickSpy.mockRestore();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it("erro com retry, vazio honesto e bloqueio não-admin", () => {
    cleanup();
    mocks.reportState = "error";
    renderPage();
    expect(screen.getByText("Não foi possível carregar o relatório")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    cleanup();
    mocks.reportState = "empty";
    renderPage();
    expect(screen.getByText("Sem dados neste período")).toBeTruthy();
    cleanup();
    mocks.isAdmin = false;
    renderPage();
    expect(screen.getByText("Acesso indisponível")).toBeTruthy();
  });
});
