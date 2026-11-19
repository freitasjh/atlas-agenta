// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWaitlist", () => ({
  useWaitlistEntries: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useEnqueueWaitlist: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRespondWaitlistOffer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkWaitlistAttended: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkWaitlistExpired: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveWaitlistEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReorderWaitlistEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOfferNextWaitlist: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

import { WaitlistEnrollDialog } from "@/app/lista-espera/WaitlistEnrollDialog";
import { waitlistMessages } from "@/app/lista-espera/waitlist-messages";
import { WaitlistCta } from "@/app/agenda/WaitlistCta";

afterEach(cleanup);

const messages = waitlistMessages;

const options = {
  customers: [{ id: "c1", name: "Maria Silva" }],
  services: [{ id: "s1", name: "Corte" }],
  professionals: [{ id: "p1", name: "João" }],
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("WaitlistEnrollDialog", () => {
  it("valida campos obrigatórios em pt-BR antes de enviar", async () => {
    const onSubmit = vi.fn();
    renderWithClient(
      <WaitlistEnrollDialog
        open
        onOpenChange={vi.fn()}
        messages={messages}
        {...options}
        submitting={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Entrar na lista de espera" }));
    await waitFor(() => {
      expect(screen.getAllByText("Campo obrigatório.").length).toBeGreaterThan(0);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("recusa período com fim antes do início", async () => {
    renderWithClient(
      <WaitlistEnrollDialog
        open
        onOpenChange={vi.fn()}
        messages={messages}
        {...options}
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );
    const dates = screen.getAllByDisplayValue("");
    fireEvent.change(dates[0], { target: { value: "2026-02-10" } });
    fireEvent.change(dates[1], { target: { value: "2026-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar na lista de espera" }));
    await waitFor(() => {
      expect(screen.getByText("O fim do período precisa ser depois do início.")).toBeDefined();
    });
  });
});

describe("WaitlistCta", () => {
  it("sem entitlement não renderiza nada", () => {
    const { container } = renderWithClient(<WaitlistCta entitled={false} />);
    expect(screen.queryByRole("button", { name: "Entrar na lista de espera" })).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("com entitlement exibe entrar e ver lista", () => {
    renderWithClient(<WaitlistCta entitled />);
    expect(screen.getByRole("button", { name: "Entrar na lista de espera" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver lista de espera" })).toBeDefined();
  });
});
