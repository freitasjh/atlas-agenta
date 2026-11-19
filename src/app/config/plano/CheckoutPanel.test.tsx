// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckoutPanel } from "@/app/config/plano/CheckoutPanel";
import { PLANS } from "@/lib/plans";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  data: null as null | {
    kind: "upgrade" | "downgrade";
    pix_qr_code?: string | null;
    pix_copy_paste?: string | null;
    expires_at?: string | null;
    effective_at?: string | null;
    scheduled?: boolean | null;
  },
  reset: vi.fn(),
  tenant: { timezone: "America/Sao_Paulo" } as unknown,
  subscriptionStatus: "pendente" as string | null | undefined,
}));

vi.mock("@/hooks/useSelfCheckout", () => ({
  useCreateSelfCheckout: () => ({
    mutate: mocks.mutate,
    isPending: mocks.isPending,
    isError: mocks.isError,
    data: mocks.data,
    reset: mocks.reset,
  }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: mocks.tenant,
    subscriptionStatus: mocks.subscriptionStatus,
  }),
}));

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.reset.mockReset();
  mocks.isPending = false;
  mocks.isError = false;
  mocks.data = null;
  mocks.subscriptionStatus = "pendente";
});

function renderPanel(entitled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CheckoutPanel
          entitled={entitled}
          currentSlug="starter"
          catalog={[...PLANS]}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("CheckoutPanel (RF-37/RF-38)", () => {
  it("whenEntitled_thenListsOtherPlansWithoutCurrent", () => {
    renderPanel(true);
    expect(screen.getByText("Trocar de plano")).toBeDefined();
    expect(screen.getByText("Premium")).toBeDefined();
    expect(screen.getByText("Enterprise")).toBeDefined();
    expect(screen.queryByText("Starter")).toBeNull();
  });

  it("whenNotEntitled_thenShowsUpsellWithoutFiringRequest", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("sem rede"));
    try {
      renderPanel(false);
      expect(
        screen.getByText(/recurso não incluído no plano atual/),
      ).toBeDefined();
      expect(mocks.mutate).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("whenOptionChosen_thenShowsConfirmDialog", () => {
    renderPanel(true);
    fireEvent.click(screen.getAllByRole("button", { name: /Escolher plano/ })[0]);
    expect(screen.getByText(/Confirmar troca de plano/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Confirmar e gerar PIX/ }),
    ).toBeDefined();
  });

  it("whenConfirmed_thenMutatesWithPlanSlug", () => {
    renderPanel(true);
    fireEvent.click(screen.getAllByRole("button", { name: /Escolher plano/ })[0]);
    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar e gerar PIX/ }),
    );
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({ plan: "free" });
  });

  it("whenUpgradePending_thenShowsPixAndPolling", async () => {
    mocks.data = {
      kind: "upgrade",
      pix_qr_code: "qr",
      pix_copy_paste: "copia",
      expires_at: "2030-01-01T00:00:00.000Z",
      effective_at: null,
    };
    // Simula o estado pós-confirmação: o componente precisa de `selected`
    // preenchido; força via escolha + sucesso otimista da mutação.
    mocks.mutate.mockImplementation((_input, options) => {
      (options as { onSuccess?: () => void }).onSuccess?.();
    });
    renderPanel(true);
    fireEvent.click(screen.getAllByRole("button", { name: /Escolher plano/ })[1]);
    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar e gerar PIX/ }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Aguardando pagamento/)).toBeDefined(),
    );
  });

  it("whenUpgradePending_thenVerificarStatusRefreshesTenant", async () => {
    mocks.subscriptionStatus = "pendente";
    mocks.data = {
      kind: "upgrade",
      pix_qr_code: "qr",
      pix_copy_paste: "copia",
      expires_at: "2030-01-01T00:00:00.000Z",
      effective_at: null,
    };
    mocks.mutate.mockImplementation((_input, options) => {
      (options as { onSuccess?: () => void }).onSuccess?.();
    });
    const invalidateSpy = vi.spyOn(
      QueryClient.prototype,
      "invalidateQueries",
    );
    try {
      renderPanel(true);
      fireEvent.click(
        screen.getAllByRole("button", { name: /Escolher plano/ })[1],
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Confirmar e gerar PIX/ }),
      );
      await waitFor(() =>
        expect(screen.getByText(/Aguardando pagamento/)).toBeDefined(),
      );
      invalidateSpy.mockClear();
      fireEvent.click(
        screen.getByRole("button", { name: /Verificar status/ }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["tenant"],
      });
    } finally {
      invalidateSpy.mockRestore();
    }
  });

  it("whenSubscriptionLeavesPendente_thenStopsPolling", async () => {
    mocks.subscriptionStatus = "ativo";
    mocks.data = {
      kind: "upgrade",
      pix_qr_code: "qr",
      pix_copy_paste: "copia",
      expires_at: "2030-01-01T00:00:00.000Z",
      effective_at: null,
    };
    mocks.mutate.mockImplementation((_input, options) => {
      (options as { onSuccess?: () => void }).onSuccess?.();
    });
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    try {
      renderPanel(true);
      fireEvent.click(
        screen.getAllByRole("button", { name: /Escolher plano/ })[1],
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Confirmar e gerar PIX/ }),
      );
      await waitFor(() =>
        expect(screen.getByText(/Aguardando pagamento/)).toBeDefined(),
      );
      // `waitFor` interno também usa `setInterval`: filtra pelo polling (4s).
      const pollingCalls = setIntervalSpy.mock.calls.filter(
        (call) => call[1] === 4000,
      );
      expect(pollingCalls).toHaveLength(0);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it("whenUpgradePending_thenPollingStopsAtCap", async () => {
    vi.useFakeTimers();
    const invalidateSpy = vi.spyOn(
      QueryClient.prototype,
      "invalidateQueries",
    );
    try {
      mocks.subscriptionStatus = "pendente";
      mocks.data = {
        kind: "upgrade",
        pix_qr_code: "qr",
        pix_copy_paste: "copia",
        expires_at: "2030-01-01T00:00:00.000Z",
        effective_at: null,
      };
      mocks.mutate.mockImplementation((_input, options) => {
        (options as { onSuccess?: () => void }).onSuccess?.();
      });
      renderPanel(true);
      fireEvent.click(
        screen.getAllByRole("button", { name: /Escolher plano/ })[1],
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Confirmar e gerar PIX/ }),
      );
      expect(screen.getByText(/Aguardando pagamento/)).toBeDefined();
      invalidateSpy.mockClear();
      await vi.advanceTimersByTimeAsync(4000 * 80);
      const tenantCalls = invalidateSpy.mock.calls.filter(
        (call) =>
          (call[0] as { queryKey?: unknown } | undefined)?.queryKey !==
            undefined &&
          JSON.stringify(
            (call[0] as { queryKey: unknown }).queryKey,
          ) === JSON.stringify(["tenant"]),
      );
      // Teto de ~5min: 75 execuções, sem polling infinito.
      expect(tenantCalls.length).toBe(75);
    } finally {
      invalidateSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("whenDowngradeScheduled_thenShowsScheduleWithoutPaymentCopy", async () => {
    mocks.subscriptionStatus = "ativo";
    mocks.data = {
      kind: "downgrade",
      pix_qr_code: null,
      pix_copy_paste: null,
      expires_at: null,
      effective_at: "2030-02-01T03:00:00.000Z",
      scheduled: true,
    };
    mocks.mutate.mockImplementation((_input, options) => {
      (options as { onSuccess?: () => void }).onSuccess?.();
    });
    renderPanel(true);
    fireEvent.click(screen.getAllByRole("button", { name: /Escolher plano/ })[0]);
    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar e gerar PIX/ }),
    );
    await waitFor(() =>
      expect(screen.getByText("Downgrade agendado")).toBeDefined(),
    );
    expect(screen.getByText(/Downgrade agendado para 01\/02\/2030/))
      .toBeDefined();
    expect(screen.queryByText(/Pagamento confirmado/)).toBeNull();
    expect(screen.queryByText(/Verificar status/)).toBeNull();
  });

  it("whenMutationFails_thenShowsErrorWithRetry", () => {
    mocks.isError = true;
    renderPanel(true);
    expect(
      screen.getByText(/Não foi possível gerar a cobrança/),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Tentar novamente/ }),
    ).toBeDefined();
  });
});
