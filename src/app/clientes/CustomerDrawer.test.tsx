// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "admin" as "admin" | "receptionist" | "professional",
  summary: {
    noShowCount: 2,
    lastVisitAt: "2026-09-01T10:00:00.000Z",
    avgTicketCents: 15000,
    tags: ["vip"],
    segment: "recorrente",
    whatsappOptIn: true,
    whatsappOptInAt: "2026-08-01T10:00:00.000Z",
    lgpdConsentAt: "2026-08-01T10:05:00.000Z",
    lgpdConsentVersion: "v1",
  } as unknown,
  history: [
    {
      id: "a1",
      startsAt: "2026-09-01T10:00:00.000Z",
      serviceName: "Corte",
      professionalName: "João",
      status: "concluido",
      priceCents: 15000,
    },
  ] as Array<Record<string, unknown>>,
  historyLoading: false,
  notes: [
    {
      id: "n1",
      customerId: "c1",
      authorRole: "receptionist",
      visibility: "operational",
      appointmentId: null,
      body: "Prefere manhã.",
      createdAt: "2026-09-02T10:00:00.000Z",
    },
  ] as Array<Record<string, unknown>>,
  preferences: {
    preferredProfessionalId: null,
    preferredTimeWindow: "manhã",
    observations: "Cabelo sensível.",
    tags: ["vip"],
    segment: "recorrente",
  } as unknown,
  messages: [
    {
      id: "m1",
      template: "lembrete_d1",
      status: "entregue",
      created_at: "2026-09-03T10:00:00.000Z",
    },
  ] as Array<Record<string, unknown>>,
  fidelidade: { fidelidade: true } as unknown,
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

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.fidelidade,
}));

vi.mock("@/hooks/useEffectiveProfessionalId", () => ({
  useEffectiveProfessionalId: () => undefined,
}));

vi.mock("@/hooks/useCustomerCrm", () => ({
  useCustomerSummary: () => ({ data: mocks.summary, isLoading: false, isError: false, refetch: vi.fn() }),
  useCustomerHistory: () => ({ data: mocks.history, isLoading: mocks.historyLoading, isError: false, refetch: vi.fn() }),
  useCustomerNotes: () => ({ data: mocks.notes, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateCustomerNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCustomerPreferences: () => ({ data: mocks.preferences, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateCustomerPreferences: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCustomerMessages: () => ({ data: mocks.messages, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateCustomerConsent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useFidelidade", () => ({
  useLoyaltyProgram: () => ({ data: null, isLoading: false }),
  useLoyaltyAccounts: () => ({ data: [], isLoading: false }),
  useLoyaltyTransactions: () => ({ data: [], isLoading: false }),
}));

import { CustomerDrawer } from "@/app/clientes/CustomerDrawer";
import type { Customer } from "@/types/domain";

const customer: Customer = {
  id: "c1",
  tenant_id: "t1",
  name: "Ana Souza",
  phone: "11987654321",
  email: null,
  whatsapp_opt_in: true,
  active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CustomerDrawer open onOpenChange={() => undefined} customer={customer} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}


function activateTab(tab: HTMLElement) {
  tab.focus();
  fireEvent.click(tab);
}

afterEach(cleanup);


describe("CustomerDrawer — ficha do cliente (RF-24)", () => {
  it("abre com as 6 abas", async () => {
    mocks.role = "admin";
    renderDrawer();
    for (const tab of ["Resumo", "Histórico", "Preferências", "Notas", "Fidelidade", "Mensagens"]) {
      expect(await screen.findByRole("tab", { name: tab })).toBeTruthy();
    }
  });

  it("resumo exibe no-show, última visita e ticket para admin", async () => {
    mocks.role = "admin";
    renderDrawer();
    expect((await screen.findAllByText(/faltas/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/R\$\s?150,00/)).toBeTruthy();
  });

  it("ticket médio oculto para receptionist (RF-25)", async () => {
    mocks.role = "receptionist";
    renderDrawer();
    expect((await screen.findAllByText(/faltas/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/R\$\s?150,00/)).toBeNull();
  });

  it("ticket médio oculto para professional", async () => {
    mocks.role = "professional";
    renderDrawer();
    expect((await screen.findAllByText(/faltas/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/R\$\s?150,00/)).toBeNull();
  });

  it("consentimento exibe data/hora (RF-30)", async () => {
    mocks.role = "admin";
    renderDrawer();
    expect(await screen.findByText(/consentimento/i)).toBeTruthy();
  });

  it("aba notas: receptionist vê criar nota; professional não vê operacional", async () => {
    mocks.role = "receptionist";
    const { unmount } = renderDrawer();
    const tab = await screen.findByRole("tab", { name: "Notas" });
    activateTab(tab);
    expect(await screen.findByText(/Prefere manhã/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /nova nota/i })).toBeTruthy();
    unmount();
    cleanup();
    mocks.role = "professional";
    renderDrawer();
    const tab2 = await screen.findByRole("tab", { name: "Notas" });
    activateTab(tab2);
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).queryByText(/Prefere manhã/)).toBeNull();
  });

  it("aba histórico lista atendimentos; valores só admin", async () => {
    mocks.role = "admin";
    const { unmount } = renderDrawer();
    activateTab(await screen.findByRole("tab", { name: "Histórico" }));
    expect(await screen.findByText("Corte")).toBeTruthy();
    expect(screen.getByText(/R\$\s?150,00/)).toBeTruthy();
    unmount();
    cleanup();
    mocks.role = "receptionist";
    renderDrawer();
    activateTab(await screen.findByRole("tab", { name: "Histórico" }));
    expect(await screen.findByText("Corte")).toBeTruthy();
    expect(screen.queryByText(/R\$\s?150,00/)).toBeNull();
  });

  it("aba mensagens lista disparos", async () => {
    mocks.role = "admin";
    renderDrawer();
    activateTab(await screen.findByRole("tab", { name: "Mensagens" }));
    expect(await screen.findByText(/lembrete/i)).toBeTruthy();
  });
});
