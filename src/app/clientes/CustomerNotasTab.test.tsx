// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    role: "professional" as "admin" | "receptionist" | "professional",
    ownProfessionalId: "p1" as string | undefined,
    notes: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: mocks.role === "admin",
    isReceptionist: mocks.role === "receptionist",
    isProfessional: mocks.role === "professional",
    canManageCustomers: mocks.role !== "professional",
    canViewFinancials: mocks.role === "admin",
    canSendWhatsAppMessage: true,
  }),
}));

vi.mock("@/hooks/useEffectiveProfessionalId", () => ({
  useEffectiveProfessionalId: () => mocks.ownProfessionalId,
}));

vi.mock("@/hooks/useCustomerCrm", () => ({
  useCustomerNotes: () => ({
    data: mocks.notes,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateCustomerNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CustomerNotasTab } from "@/app/clientes/CustomerNotasTab";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return render(createElement(CustomerNotasTab, { customerId: "c1" }), { wrapper });
}

afterEach(cleanup);

describe("CustomerNotasTab — professional vê a própria nota (RF-28)", () => {
  const ownNote = {
    id: "n2",
    customerId: "c1",
    authorRole: "professional",
    visibility: "appointment",
    appointmentId: "a1",
    appointmentProfessionalId: "p1",
    body: "Nota do próprio atendimento.",
    createdAt: "2026-09-02T10:00:00.000Z",
  };
  const otherNote = {
    id: "n3",
    customerId: "c1",
    authorRole: "professional",
    visibility: "appointment",
    appointmentId: "a9",
    appointmentProfessionalId: "p9",
    body: "Nota de outro profissional.",
    createdAt: "2026-09-02T11:00:00.000Z",
  };
  const operationalNote = {
    id: "n1",
    customerId: "c1",
    authorRole: "receptionist",
    visibility: "operational",
    appointmentId: null,
    appointmentProfessionalId: null,
    body: "Prefere manhã.",
    createdAt: "2026-09-02T10:00:00.000Z",
  };

  it("professional vê só a nota do próprio atendimento", async () => {
    mocks.role = "professional";
    mocks.ownProfessionalId = "p1";
    mocks.notes = [operationalNote, ownNote, otherNote];
    setup();

    const list = await screen.findByRole("list", { name: /notas do cliente/i });
    expect(within(list).queryByText(/próprio atendimento/)).toBeTruthy();
    expect(within(list).queryByText(/Prefere manhã/)).toBeNull();
    expect(within(list).queryByText(/outro profissional/)).toBeNull();
  });

  it("professional sem vínculo não vê nota de atendimento", async () => {
    mocks.role = "professional";
    mocks.ownProfessionalId = undefined;
    mocks.notes = [ownNote];
    setup();

    expect(await screen.findByText(/sem notas visíveis/i)).toBeTruthy();
  });

  it("receptionist continua vendo só operacionais", async () => {
    mocks.role = "receptionist";
    mocks.ownProfessionalId = undefined;
    mocks.notes = [operationalNote, ownNote];
    setup();

    const list = await screen.findByRole("list", { name: /notas do cliente/i });
    expect(within(list).queryByText(/Prefere manhã/)).toBeTruthy();
    expect(within(list).queryByText(/próprio atendimento/)).toBeNull();
  });
});
