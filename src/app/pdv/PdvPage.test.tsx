// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PdvPage } from "@/app/pdv/PdvPage";
import { WalkInBadge } from "@/app/pdv/WalkInBadge";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

const mocks = vi.hoisted(() => ({
  payments: true as boolean | null,
  professionals: [
    { id: "44444444-4444-4444-4444-444444444444", name: "Beto", active: true },
  ],
  services: [
    {
      id: "55555555-5555-5555-5555-555555555555",
      name: "Corte",
      price_cents: 5000,
      duration_minutes: 30,
      active: true,
    },
  ],
  pending: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canRegisterPayments: true,
    canManageAppointments: true,
    canScheduleForAnyProfessional: true,
    isAdmin: true,
    isProfessional: false,
    isReceptionist: false,
    canViewFinancials: true,
  }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ payments: mocks.payments, commission: true, combos: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: { timezone: "America/Sao_Paulo" },
    userId: "u1",
    role: "admin",
  }),
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: mocks.professionals, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: mocks.services, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useCombos", () => ({
  useCombos: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useAppointments", () => ({
  useAppointments: () => ({
    data: mocks.pending,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWalkIn", () => ({
  newCreationKey: () => "66666666-6666-6666-6666-666666666666",
  useCreateWalkIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCreateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/app/agenda/pagamentos/PaymentCaptureDialog", () => ({
  PaymentCaptureDialog: () => null,
}));

function wrapper(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(
    QueryClientProvider,
    { client },
    createElement(MemoryRouter, null, children),
  );
}

afterEach(() => {
  cleanup();
  mocks.pending = [];
  mocks.payments = true;
});

describe("PdvPage — PDV balcão (ADR-23)", () => {
  it("renderiza o formulário de venda quando payments é true", () => {
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    expect(screen.getByText(paymentsMessages.pdv.title)).toBeTruthy();
    expect(screen.getByText(paymentsMessages.pdv.createSale)).toBeTruthy();
    expect(screen.getByText(paymentsMessages.pdv.pendingList)).toBeTruthy();
  });

  it("mostra painel de ramo quando payments é false", () => {
    mocks.payments = false;
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    expect(screen.getByText(paymentsMessages.pdv.segmentOnlyDescription)).toBeTruthy();
  });

  it("exibe Cliente de balcão na lista A concluir hoje", () => {
    mocks.pending = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        tenant_id: "22222222-2222-2222-2222-222222222222",
        origin: "walk_in",
        customer_id: null,
        professional_id: "44444444-4444-4444-4444-444444444444",
        service_id: "55555555-5555-5555-5555-555555555555",
        combo_id: null,
        starts_at: "2026-11-09T15:00:00.000Z",
        ends_at: "2026-11-09T15:30:00.000Z",
        price_cents: 5000,
        status: "em_atendimento",
        confirmed_at: null,
        confirmed_via: null,
        created_at: "2026-11-09T14:55:00.000Z",
        customers: null,
        services: { name: "Corte", duration_minutes: 30, price_cents: 5000 },
        combos: null,
        professionals: { name: "Beto" },
        commission_cents: null,
      },
    ];
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    expect(screen.getByText("Cliente de balcão")).toBeTruthy();
    expect(screen.getByText("Balcão")).toBeTruthy();
  });

  it("WalkInBadge renderiza o selo Balcão", () => {
    render(createElement(WalkInBadge));
    expect(screen.getByText("Balcão")).toBeTruthy();
  });

  it("marcar 'Identificar cliente' revela os campos e desmarcar limpa", () => {
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    expect(screen.queryByLabelText(paymentsMessages.pdv.customerName)).toBeNull();
    expect(screen.getByText(paymentsMessages.pdv.anonymousHint)).toBeTruthy();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const name = screen.getByLabelText(paymentsMessages.pdv.customerName) as HTMLInputElement;
    const phone = screen.getByLabelText(paymentsMessages.pdv.customerPhone) as HTMLInputElement;
    expect(name).toBeTruthy();
    expect(phone).toBeTruthy();

    fireEvent.change(name, { target: { value: "Ana" } });
    fireEvent.change(phone, { target: { value: "11999998888" } });
    expect(name.value).toBe("Ana");

    fireEvent.click(checkbox);
    expect(screen.queryByLabelText(paymentsMessages.pdv.customerName)).toBeNull();
    expect(screen.getByText(paymentsMessages.pdv.anonymousHint)).toBeTruthy();

    fireEvent.click(checkbox);
    expect(
      (screen.getByLabelText(paymentsMessages.pdv.customerName) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText(paymentsMessages.pdv.customerPhone) as HTMLInputElement).value,
    ).toBe("");
  });
});
