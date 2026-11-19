// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmpresasPage } from "@/internal-admin/empresas/EmpresasPage";
import type { TenantListItem } from "@/types/domain";

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    functions: { invoke: vi.fn() },
  },
}));

const TENANT: TenantListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  trade_name: "Studio Alfa",
  legal_name: "Alfa LTDA",
  document: null,
  owner_email: "alfa@exemplo.com",
  plan: "premium",
  subscription_status: "ativo",
  trial_ends_at: null,
  timezone: "America/Sao_Paulo",
  created_at: "2026-01-01T00:00:00.000Z",
};

function wrapper(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("EmpresasPage — abas do back-office (ADR-11)", () => {
  beforeEach(() => {
    const result = Promise.resolve({ data: [TENANT], error: null });
    const builder = {
      select: () => builder,
      order: () => result,
    };
    fromMock.mockReturnValue(builder);
    rpcMock.mockResolvedValue({
      data: [
        {
          slug: "starter",
          name: "Starter",
          price_cents: 5900,
          prof_limit: 1,
          appt_limit: 150,
          features: ["agendamento"],
          active: true,
          sort_order: 2,
        },
      ],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("abre na aba Empresas com a lista existente", async () => {
    render(wrapper(<EmpresasPage />));

    await waitFor(() =>
      expect(screen.getAllByText("Studio Alfa").length).toBeGreaterThan(0),
    );
    expect(screen.getByRole("tab", { name: "Empresas" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Operação" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Métricas" })).toBeDefined();
  });

  it("aba Operação respeita o gating: catálogo sem flags bloqueia legível", async () => {
    render(wrapper(<EmpresasPage />));

    await waitFor(() =>
      expect(screen.getAllByText("Studio Alfa").length).toBeGreaterThan(0),
    );
    const tab = screen.getByRole("tab", { name: "Operação" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);

    await waitFor(() =>
      expect(screen.getByText(/Operação: recurso não incluído/i)).toBeDefined(),
    );
  });
});
