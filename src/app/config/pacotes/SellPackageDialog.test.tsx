// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sellMock, successMock, errorMock } = vi.hoisted(() => ({
  sellMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: successMock, error: errorMock },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    isReceptionist: true,
    canManageCustomers: true,
  }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({
    data: [{ id: "c-1", name: "Maria" }],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({
    data: [{ id: "s-1", name: "Limpeza de pele" }],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePackageCredits", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/usePackageCredits")>();
  return {
    ...actual,
    usePackageBalance: () => ({ data: [], isLoading: false }),
    useSellPackage: () => ({ mutateAsync: sellMock, isPending: false }),
  };
});

import { SellPackageDialog } from "@/app/config/pacotes/SellPackageDialog";

function renderDialog(props?: { defaultCustomerId?: string | null }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SellPackageDialog open onOpenChange={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sellMock.mockReset();
  successMock.mockReset();
  errorMock.mockReset();
  sellMock.mockResolvedValue("credito-novo");
});

afterEach(cleanup);

describe("SellPackageDialog — venda no Clientes/Drawer (ADR-06)", () => {
  it("tem labels visíveis (nunca placeholder-only) e resumo antes de confirmar", () => {
    renderDialog();
    expect(screen.getByText("Cliente")).toBeDefined();
    expect(screen.getByText("Serviço do pacote")).toBeDefined();
    expect(screen.getByText("Número de sessões")).toBeDefined();
    expect(screen.getByText("Preço do pacote")).toBeDefined();
    expect(screen.getByText("Validade (dias)")).toBeDefined();
  });

  it("vende via sell_package com os campos mapeados e avisa sucesso", async () => {
    renderDialog({ defaultCustomerId: "c-1" });

    fireEvent.change(screen.getByLabelText("Serviço do pacote"), {
      target: { value: "s-1" },
    });
    fireEvent.change(screen.getByLabelText("Número de sessões"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venda" }));

    await waitFor(() => expect(sellMock).toHaveBeenCalledTimes(1));
    expect(sellMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "c-1",
        serviceId: "s-1",
        totalSessions: 5,
      }),
    );
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        expect.stringMatching(/pacote vendido/i),
      ),
    );
  });

  it("mostra resumo da venda com total, preço e expiração", () => {
    renderDialog({ defaultCustomerId: "c-1" });
    fireEvent.change(screen.getByLabelText("Serviço do pacote"), {
      target: { value: "s-1" },
    });
    expect(screen.getByText(/resumo da venda/i)).toBeDefined();
    expect(screen.getByText(/5 sessões/)).toBeDefined();
  });
});
