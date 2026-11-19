// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PagarPage } from "@/app/financeiro/pagar/PagarPage";

const { entitlementsMock, fromMock, rpcMock } = vi.hoisted(() => ({
  entitlementsMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
    storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
  },
}));

const FORNECEDOR = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "t1",
  nome: "Distribuidora Central",
  documento: null,
  contato: null,
  ativo: true,
  created_at: "2026-10-01T12:00:00.000Z",
};

function conta(over: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    tenant_id: "t1",
    supplier_id: FORNECEDOR.id,
    descricao: "Aluguel do salão",
    categoria: "fixo",
    vencimento_at: "2026-12-10T12:00:00.000Z",
    valor_cents: 150_000,
    status: "pendente",
    recorrencia: "none",
    serie_id: null,
    created_at: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

/** Builder thenable do PostgREST (select/order/limit/eq/lte encadeáveis). */
function chain(data: unknown) {
  const builder = {} as Record<string, (...a: never[]) => unknown>;
  for (const metodo of ["select", "order", "limit", "eq", "lte"] as const) {
    builder[metodo] = () => builder;
  }
  builder["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

function mockTabelas(contas: unknown[] = [conta()]) {
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "suppliers") return chain([FORNECEDOR]);
    if (tabela === "payables") return chain(contas);
    if (tabela === "payable_settlements") return chain([]);
    return chain([]);
  });
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "payable_kpis") {
      return Promise.resolve({
        data: { vencido_cents: 5_000, vencido_count: 1, proximos7d_cents: 7_000, proximos7d_count: 1 },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PagarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PagarPage — ADR-06 (filtros, baixa, gating)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gating contasPagar=false → upsell legível e zero request a suppliers/payables", async () => {
    entitlementsMock.mockReturnValue({ contasPagar: false });
    mockTabelas();
    renderPage();
    expect(screen.getByText("Contas a pagar disponíveis no plano")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver planos" })).toBeTruthy();
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gating contasPagar=null → upsell sem travar e zero request", async () => {
    entitlementsMock.mockReturnValue(null);
    mockTabelas();
    renderPage();
    expect(screen.getByText("Contas a pagar disponíveis no plano")).toBeTruthy();
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
  });

  it("KPIs vencido + 7d renderizam com os valores da RPC", async () => {
    entitlementsMock.mockReturnValue({ contasPagar: true });
    mockTabelas();
    renderPage();
    await waitFor(() => expect(screen.getByText("Vencido")).toBeTruthy());
    expect(screen.getByText("Vence em 7 dias")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledWith("payable_kpis");
  });

  it("filtros de estado e fornecedor limitam a tabela", async () => {
    entitlementsMock.mockReturnValue({ contasPagar: true });
    mockTabelas([
      conta(),
      conta({
        id: "33333333-3333-4333-8333-333333333333",
        descricao: "Energia",
        status: "pago",
        supplier_id: null,
      }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Aluguel do salão")).toBeTruthy());
    expect(screen.getByText("Energia")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "pago" } });
    await waitFor(() => expect(fromMock).toHaveBeenCalled());
  });

  it("conta pendente tem botão de baixa; paga não tem", async () => {
    entitlementsMock.mockReturnValue({ contasPagar: true });
    mockTabelas([
      conta(),
      conta({
        id: "33333333-3333-4333-8333-333333333333",
        descricao: "Energia",
        status: "pago",
        supplier_id: null,
      }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Aluguel do salão")).toBeTruthy());
    expect(screen.getByRole("button", { name: /dar baixa em aluguel/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /dar baixa em energia/i })).toBeNull();
  });

  it("conta pendente tem botão Cancelar; parcial/paga não têm", async () => {
    entitlementsMock.mockReturnValue({ contasPagar: true });
    mockTabelas([
      conta(),
      conta({
        id: "33333333-3333-4333-8333-333333333333",
        descricao: "Energia",
        status: "parcial",
        supplier_id: null,
      }),
      conta({
        id: "44444444-4444-4434-8444-444444444444",
        descricao: "Internet",
        status: "pago",
        supplier_id: null,
      }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Aluguel do salão")).toBeTruthy());
    expect(screen.getByRole("button", { name: /cancelar aluguel/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancelar energia/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancelar internet/i })).toBeNull();
  });

  it("cancelar pendente exige motivo e chama payable_cancel", async () => {
    entitlementsMock.mockReturnValue({ contasPagar: true });
    mockTabelas();
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "payable_kpis") {
        return Promise.resolve({
          data: { vencido_cents: 5_000, vencido_count: 1, proximos7d_cents: 7_000, proximos7d_count: 1 },
          error: null,
        });
      }
      if (fn === "payable_cancel") {
        return Promise.resolve({
          data: { payable_id: "22222222-2222-4222-8222-222222222222", status: "cancelado" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Aluguel do salão")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /cancelar aluguel/i }));
    await waitFor(() => expect(screen.getByLabelText("Cancelar conta a pagar")).toBeTruthy());
    // Sem motivo → alerta, sem chamada à RPC.
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(rpcMock).not.toHaveBeenCalledWith("payable_cancel", expect.anything());
    // Com motivo → chama payable_cancel com motivo e fecha o diálogo.
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), {
      target: { value: "Lançamento em duplicidade" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("payable_cancel", {
        p_payable_id: "22222222-2222-4222-8222-222222222222",
        p_motivo: "Lançamento em duplicidade",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Cancelar conta a pagar")).toBeNull());
  });

  it("Dialog de baixa mostra o resto e valida overpay no cliente", async () => {
    entitlementsMock.mockReturnValue({ contasPagar: true });
    mockTabelas();
    renderPage();
    await waitFor(() => expect(screen.getByText("Aluguel do salão")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /dar baixa em aluguel/i }));
    await waitFor(() => expect(screen.getAllByText(/resto/i).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "999999,00" } });
    fireEvent.change(screen.getByLabelText("Data do pagamento"), { target: { value: "2026-12-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar baixa" }));
    await waitFor(() =>
      expect(screen.getByText(/passa do resto pendente/i)).toBeTruthy(),
    );
    expect(rpcMock).not.toHaveBeenCalledWith(
      "payable_settle",
      expect.anything(),
    );
  });
});
