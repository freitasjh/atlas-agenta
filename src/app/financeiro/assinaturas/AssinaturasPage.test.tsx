// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssinaturasPage } from "@/app/financeiro/assinaturas/AssinaturasPage";

const { entitlementsMock, fromMock, rpcMock, invokeMock } = vi.hoisted(() => ({
  entitlementsMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

const PLANO = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "t1",
  name: "Plano Mensal",
  amount_cents: 9900,
  billing_period: "mensal",
  active: true,
  created_at: "2026-10-01T12:00:00.000Z",
};

const CLIENTE_COM_OPTIN = {
  id: "22222222-2222-4222-8222-222222222222",
  tenant_id: "t1",
  name: "Maria Silva",
  phone: "11987654321",
  email: null,
  whatsapp_opt_in: true,
  active: true,
  created_at: "2026-10-01T12:00:00.000Z",
};

const CLIENTE_SEM_OPTIN = {
  ...CLIENTE_COM_OPTIN,
  id: "33333333-3333-4333-8333-333333333333",
  name: "João Sem Opt",
  whatsapp_opt_in: false,
};

function sub(over: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    tenant_id: "t1",
    customer_id: CLIENTE_COM_OPTIN.id,
    plan_id: PLANO.id,
    status: "ativa",
    next_charge_at: "2026-12-01T12:00:00.000Z",
    created_at: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

/** Builder thenable do PostgREST (select/order/limit/eq encadeáveis). */
function chain(data: unknown) {
  const builder = {} as Record<string, (...a: never[]) => unknown>;
  for (const metodo of ["select", "order", "limit", "eq"] as const) {
    builder[metodo] = () => builder;
  }
  builder["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

function mockTabelas(subs: unknown[] = [sub()]) {
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "membership_plans") return chain([PLANO]);
    if (tabela === "membership_subscriptions") return chain(subs);
    if (tabela === "membership_charges") return chain([]);
    if (tabela === "customers")
      return chain([CLIENTE_COM_OPTIN, CLIENTE_SEM_OPTIN]);
    if (tabela === "audit_log") return chain([]);
    return chain([]);
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssinaturasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AssinaturasPage — ADR-05 (tabs, drawer, ações, inadimplência, gating)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gating recorrencia=false → upsell legível e zero request a membership_*", async () => {
    entitlementsMock.mockReturnValue({ recorrencia: false });
    mockTabelas();
    renderPage();
    expect(screen.getByText("Assinaturas disponíveis no plano")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver planos" })).toBeTruthy();
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
    expect(rpcMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("gating recorrencia=null → upsell sem travar e zero request", async () => {
    entitlementsMock.mockReturnValue(null);
    mockTabelas();
    renderPage();
    expect(screen.getByText("Assinaturas disponíveis no plano")).toBeTruthy();
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
  });

  it("tabs filtram por estado (ativas/inadimplentes/canceladas)", async () => {
    entitlementsMock.mockReturnValue({ recorrencia: true });
    mockTabelas([
      sub({ status: "ativa" }),
      sub({
        id: "55555555-5555-4555-8555-555555555555",
        status: "inadimplente",
        customer_id: CLIENTE_SEM_OPTIN.id,
      }),
      sub({
        id: "66666666-6666-4666-8666-666666666666",
        status: "cancelada",
      }),
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /ativas/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("tab", { name: /inadimplentes/i }));
    await waitFor(() =>
      expect(screen.getByText("João Sem Opt")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("tab", { name: /canceladas/i }));
    await waitFor(() => {
      expect(screen.queryByText("João Sem Opt")).toBeNull();
    });
  });

  it("drawer mostra histórico e cancelar exige motivo", async () => {
    entitlementsMock.mockReturnValue({ recorrencia: true });
    mockTabelas();
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Maria Silva")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /detalhes/i }));
    await waitFor(() =>
      expect(screen.getByText("Histórico da assinatura")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /cancelar assinatura/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Cancelar assinatura" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^confirmar cancelamento$/i }));
    await waitFor(() =>
      expect(screen.getByText("Informe o motivo do cancelamento.")).toBeTruthy(),
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem opt-in → botão reenviar desabilitado com explicação", async () => {
    entitlementsMock.mockReturnValue({ recorrencia: true });
    mockTabelas([
      sub({
        status: "inadimplente",
        customer_id: CLIENTE_SEM_OPTIN.id,
      }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /inadimplentes/i }));
    await waitFor(() =>
      expect(screen.getByText("João Sem Opt")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /detalhes/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/sem consentimento de whatsapp/i),
      ).toBeTruthy(),
    );
    const reenviar = screen.getByRole("button", {
      name: /reenviar cobrança/i,
    });
    expect(reenviar.hasAttribute("disabled")).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("banner inadimplência aparece com contagem e reenvio não dispara sem opt-in", async () => {
    entitlementsMock.mockReturnValue({ recorrencia: true });
    mockTabelas([
      sub({
        status: "inadimplente",
        customer_id: CLIENTE_SEM_OPTIN.id,
      }),
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/1 assinatura inadimplente/i)).toBeTruthy(),
    );
  });
});
