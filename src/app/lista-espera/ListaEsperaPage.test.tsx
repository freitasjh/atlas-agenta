// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  entitlements: null as unknown,
  loading: false,
  error: false,
  enqueue: { mutateAsync: vi.fn(), isPending: false },
  respond: { mutateAsync: vi.fn(), isPending: false },
  attended: { mutateAsync: vi.fn(), isPending: false },
  expired: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  reorder: { mutateAsync: vi.fn(), isPending: false },
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useWaitlist", () => ({
  useWaitlistEntries: () => ({
    data: mocks.entries,
    isLoading: mocks.loading,
    isError: mocks.error,
    refetch: mocks.refetch,
  }),
  useEnqueueWaitlist: () => mocks.enqueue,
  useRespondWaitlistOffer: () => mocks.respond,
  useMarkWaitlistAttended: () => mocks.attended,
  useMarkWaitlistExpired: () => mocks.expired,
  useRemoveWaitlistEntry: () => mocks.remove,
  useReorderWaitlistEntry: () => mocks.reorder,
  useOfferNextWaitlist: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: [], isLoading: false }),
}));

import { ListaEsperaPage } from "@/app/lista-espera/ListaEsperaPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ListaEsperaPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    tenant_id: "t1",
    customer_id: "c1",
    service_id: "s1",
    professional_id: "p1",
    desired_start_from: "2026-02-01T00:00:00.000Z",
    desired_start_to: "2026-02-28T00:00:00.000Z",
    priority: 3,
    expires_at: null,
    status: "aguardando",
    offered_slot_start: null,
    offered_slot_end: null,
    offered_professional_id: null,
    offer_expires_at: null,
    created_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("ListaEsperaPage", () => {
  it("lista entradas ordenadas por prioridade", () => {
    mocks.entitlements = { waitlist: true };
    mocks.loading = false;
    mocks.error = false;
    mocks.entries = [
      baseEntry({ id: "baixa", priority: 1, customer_id: "c-baixa" }),
      baseEntry({ id: "alta", priority: 3, customer_id: "c-alta" }),
    ];
    const { container } = renderPage();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("c-alta");
  });

  it("filtra por busca de cliente", () => {
    mocks.entitlements = { waitlist: true };
    mocks.loading = false;
    mocks.error = false;
    mocks.entries = [
      baseEntry({ id: "1", customer_id: "c-maria" }),
      baseEntry({ id: "2", customer_id: "c-ana" }),
    ];
    const { container } = renderPage();
    fireEvent.change(screen.getByLabelText("Buscar cliente"), { target: { value: "c-ana" } });
    // Tabela desktop + cards mobile rendem juntos (um escondido por CSS):
    // conta as linhas da tabela.
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("c-ana");
  });

  it("gestão manual marca atendida e remove (cancelado)", async () => {
    mocks.entitlements = { waitlist: true };
    mocks.loading = false;
    mocks.error = false;
    mocks.entries = [baseEntry({})];
    mocks.attended.mutateAsync = vi.fn().mockResolvedValue(undefined);
    mocks.remove.mutateAsync = vi.fn().mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /marcar entrada de .* como atendida/i })[0]);
    await waitFor(() => expect(mocks.attended.mutateAsync).toHaveBeenCalledWith("e1"));
    fireEvent.click(screen.getAllByRole("button", { name: /remover entrada de/i })[0]);
    await waitFor(() => expect(mocks.remove.mutateAsync).toHaveBeenCalledWith("e1"));
  });

  it("oferta ofertada abre dialog com countdown e responde via RPC", async () => {
    mocks.entitlements = { waitlist: true };
    mocks.loading = false;
    mocks.error = false;
    mocks.entries = [
      baseEntry({ status: "ofertado", offer_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() }),
    ];
    mocks.respond.mutateAsync = vi.fn().mockResolvedValue({ entry_id: "e1", status: "confirmado" });
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /ver oferta/i })[0]);
    await waitFor(() => expect(screen.getByRole("timer")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(mocks.respond.mutateAsync).toHaveBeenCalledWith({ id: "e1", accept: true }),
    );
  });

  it("sem entitlement mostra upsell e não dispara request sensível", () => {
    mocks.entitlements = null;
    mocks.loading = false;
    mocks.error = false;
    mocks.entries = [];
    mocks.refetch = vi.fn();
    renderPage();
    expect(screen.getByText(/não incluído no plano atual/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /ver planos/i })).toBeDefined();
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("estado de erro oferece tentar novamente", () => {
    mocks.entitlements = { waitlist: true };
    mocks.loading = false;
    mocks.error = true;
    mocks.entries = [];
    renderPage();
    expect(screen.getByText(/não foi possível carregar a lista de espera/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeDefined();
  });
});
