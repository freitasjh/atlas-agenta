// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { customersMock } = vi.hoisted(() => ({
  customersMock: {
    list: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({
    data: customersMock.list,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDeactivateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: true,
    isReceptionist: false,
    isProfessional: false,
    canManageCustomers: true,
    canSendWhatsAppMessage: false,
    canViewFinancials: true,
  }),
}));

vi.mock("@/app/whatsapp/SendMessageDialog", () => ({
  SendMessageDialog: () => null,
}));
vi.mock("@/app/clientes/CustomerFormDialog", () => ({
  CustomerFormDialog: () => null,
}));
vi.mock("@/app/clientes/CustomerDrawer", () => ({
  CustomerDrawer: () => null,
}));
vi.mock("@/app/config/pacotes/SellPackageDialog", () => ({
  SellPackageDialog: () => null,
}));

import { ClientesPage } from "@/app/clientes/ClientesPage";

function setup() {
  customersMock.list = [
    {
      id: "c1",
      tenant_id: "t1",
      name: "Ana Souza",
      phone: "11987654321",
      email: null,
      whatsapp_opt_in: true,
      active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      tags: ["vip"],
      segment: "recorrente",
    },
    {
      id: "c2",
      tenant_id: "t1",
      name: "Bia Lima",
      phone: "11912345678",
      email: null,
      whatsapp_opt_in: false,
      active: true,
      created_at: "2026-01-02T00:00:00.000Z",
      tags: [],
      segment: "novo",
    },
  ] as unknown as Array<Record<string, unknown>>;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ClientesPage),
    ),
  );
}

afterEach(cleanup);

describe("ClientesPage — filtro no-show mínimo (RF-29)", () => {
  it("minNoShow é aplicado à lista (controle antes morto)", async () => {
    setup();
    expect(await screen.findAllByText("Ana Souza")).not.toHaveLength(0);
    expect(await screen.findAllByText("Bia Lima")).not.toHaveLength(0);

    // Sem contagem conhecida (0), minNoShow=1 exclui todas as linhas.
    fireEvent.change(screen.getByLabelText(/no-show mínimo/i), { target: { value: "1" } });
    await waitFor(() => expect(screen.queryAllByText("Ana Souza")).toHaveLength(0));
    expect(screen.queryAllByText("Bia Lima")).toHaveLength(0);
    expect(await screen.findByText(/nenhum cliente encontrado/i)).toBeTruthy();

    // Voltando a 0, a lista reaparece.
    fireEvent.change(screen.getByLabelText(/no-show mínimo/i), { target: { value: "0" } });
    expect(await screen.findAllByText("Ana Souza")).not.toHaveLength(0);
    expect(await screen.findAllByText("Bia Lima")).not.toHaveLength(0);
  });

  it("tag e segmento continuam filtrando", async () => {
    setup();
    expect(await screen.findAllByText("Ana Souza")).not.toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/segmento/i), { target: { value: "novo" } });
    await waitFor(() => expect(screen.queryAllByText("Ana Souza")).toHaveLength(0));
    expect(await screen.findAllByText("Bia Lima")).not.toHaveLength(0);
  });
});
