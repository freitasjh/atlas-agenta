// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CobrancasPage } from "@/app/cobrancas/CobrancasPage";

const mocks = vi.hoisted(() => ({
  canViewFinancials: true,
  payments: true as boolean | null,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canViewFinancials: mocks.canViewFinancials }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ payments: mocks.payments }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: { timezone: "America/Sao_Paulo" },
  }),
}));

vi.mock("@/hooks/useCharges", () => ({
  useCharges: () => ({ isLoading: false, isError: false, data: [], refetch: vi.fn() }),
}));

vi.mock("@/hooks/useReceipts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useReceipts: () => ({
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: { rows: [], total: 0 },
      refetch: vi.fn(),
    }),
  };
});

function renderPage(initialEntries = ["/app/cobrancas"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, { initialEntries }, createElement(CobrancasPage)),
    ),
  );
}

beforeEach(() => {
  mocks.canViewFinancials = true;
  mocks.payments = true;
});

afterEach(() => cleanup());

describe("CobrancasPage tabs (ADR-005 §3)", () => {
  it("admin vê as duas abas e ?aba=recebimentos abre Recebimentos", () => {
    renderPage(["/app/cobrancas?aba=recebimentos"]);
    expect(screen.getByRole("tab", { name: "Cobranças PIX" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Recebimentos" })).toBeTruthy();
    expect(screen.getByText("Nenhum recebimento no período.")).toBeTruthy();
  });

  it("recepção não vê o trigger Recebimentos no DOM", () => {
    mocks.canViewFinancials = false;
    renderPage();
    expect(screen.getByRole("tab", { name: "Cobranças PIX" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Recebimentos" })).toBeNull();
  });

  it("clínica (payments=false) não vê o trigger Recebimentos", () => {
    mocks.payments = false;
    renderPage(["/app/cobrancas?aba=recebimentos"]);
    expect(screen.queryByRole("tab", { name: "Recebimentos" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Cobranças PIX" })).toBeTruthy();
  });
});
