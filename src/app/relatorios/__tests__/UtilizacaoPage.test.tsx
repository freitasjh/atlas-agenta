// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UtilizacaoPage } from "@/app/relatorios/UtilizacaoPage";

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  reportState: "success" as "success" | "loading" | "error" | "empty",
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useRetentionReports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRetentionReports")>();
  return {
    ...actual,
    useUtilizacaoReport: () => {
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
          { key: "p1", label: "Ana", utilization_rate: 0.75, occupied_minutes: 450, available_minutes: 600 },
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
    createElement(MemoryRouter, null, createElement(wrapper, null, createElement(UtilizacaoPage))),
  );
}

beforeEach(() => {
  mocks.isAdmin = true;
  mocks.reportState = "success";
  mocks.refetch.mockClear();
});

afterEach(() => cleanup());

describe("UtilizacaoPage (ADR-17)", () => {
  it("renderiza gráfico + tabela com taxa formatada", async () => {
    renderPage();
    expect(screen.getByText("Utilização de agenda")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(await screen.findByRole("img", { name: /Gráfico de utilização/ })).toBeTruthy();
    // 0.75 → "75,0 %".
    expect(screen.getByText("75,0%")).toBeTruthy();
  });

  it("filtros alteram dados via selects", () => {
    renderPage();
    expect(screen.getByLabelText("Filtrar por profissional")).toBeTruthy();
    expect(screen.getByLabelText("Filtrar por serviço")).toBeTruthy();
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

  it("vazio honesto, erro com retry e bloqueio não-admin", () => {
    cleanup();
    mocks.reportState = "empty";
    renderPage();
    expect(screen.getByText("Sem dados neste período")).toBeTruthy();
    cleanup();
    mocks.reportState = "error";
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    cleanup();
    mocks.isAdmin = false;
    renderPage();
    expect(screen.getByText("Acesso indisponível")).toBeTruthy();
  });
});
