// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RetencaoPage } from "@/app/relatorios/RetencaoPage";

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  reportState: "success" as "success" | "loading" | "error" | "empty",
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useRetentionReports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRetentionReports")>();
  return {
    ...actual,
    useRetencaoReport: () => {
      if (mocks.reportState === "loading") {
        return { isLoading: true, isError: false, data: undefined, refetch: mocks.refetch };
      }
      if (mocks.reportState === "error") {
        return { isLoading: false, isError: true, data: undefined, refetch: mocks.refetch };
      }
      if (mocks.reportState === "empty") {
        return {
          isLoading: false,
          isError: false,
          data: { rebooking: [], noshow: [], cohorts: [] },
          refetch: mocks.refetch,
        };
      }
      return {
        isLoading: false,
        isError: false,
        refetch: mocks.refetch,
        data: {
          rebooking: [
            { key: "p1", label: "Ana", rate: 0.4, numerator: 4, denominator: 10 },
          ],
          noshow: [
            { key: "p1", label: "Ana", rate: 0.1, numerator: 1, denominator: 10 },
          ],
          cohorts: [
            { cohort: "2026-09", cohort_size: 20, retained_count: 8, retention_rate: 0.4 },
          ],
        },
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
    createElement(MemoryRouter, null, createElement(wrapper, null, createElement(RetencaoPage))),
  );
}

beforeEach(() => {
  mocks.isAdmin = true;
  mocks.reportState = "success";
  mocks.refetch.mockClear();
});

afterEach(() => cleanup());

describe("RetencaoPage (ADR-17)", () => {
  it("renderiza gráfico + tabela de rebooking, no-show e coorte", async () => {
    renderPage();
    expect(screen.getByText("Retenção e no-show")).toBeTruthy();
    expect(screen.getByText("Rebooking no período")).toBeTruthy();
    expect(screen.getByText("No-show no período")).toBeTruthy();
    expect(screen.getByText("Retenção da coorte")).toBeTruthy();
    expect(screen.getAllByText("Ana")).toHaveLength(2);
    expect(screen.getByText("Coorte 2026-09")).toBeTruthy();
    // Gráfico Recharts (lazy) presente + tabelas acessíveis.
    expect(await screen.findByRole("img", { name: /Rebooking no período/ })).toBeTruthy();
    expect(await screen.findByRole("img", { name: /No-show no período/ })).toBeTruthy();
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });

  it("filtros por profissional/serviço e período presentes", () => {
    renderPage();
    expect(screen.getByLabelText("Filtrar por profissional")).toBeTruthy();
    expect(screen.getByLabelText("Filtrar por serviço")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Período do relatório" })).toBeTruthy();
  });

  it("export CSV gera arquivo válido", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((() => "blob:csv") as typeof URL.createObjectURL);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    renderPage();
    const buttons = screen.getAllByRole("button", { name: "Exportar CSV" });
    expect(buttons.length).toBe(3);
    fireEvent.click(buttons[0]);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:csv");
    clickSpy.mockRestore();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it("loading usa aria-busy; erro tem tentar novamente", () => {
    cleanup();
    mocks.reportState = "loading";
    const { container } = renderPage();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    cleanup();
    mocks.reportState = "error";
    renderPage();
    expect(screen.getByText("Não foi possível carregar o relatório")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("não-admin vê acesso indisponível", () => {
    cleanup();
    mocks.isAdmin = false;
    renderPage();
    expect(screen.getByText("Acesso indisponível")).toBeTruthy();
    expect(screen.getByText("Você não tem acesso a este relatório.")).toBeTruthy();
  });
});
