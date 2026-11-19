// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssinaturaDrawer } from "@/app/financeiro/assinaturas/AssinaturaDrawer";
import type { AssinaturaLinha } from "@/hooks/useMembership";

const { fromMock, rpcMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

const SUB_ID = "44444444-4444-4444-8444-444444444444";

function linha(over: Record<string, unknown> = {}): AssinaturaLinha {
  return {
    subscription: {
      id: SUB_ID,
      tenant_id: "t1",
      customer_id: "22222222-2222-4222-8222-222222222222",
      plan_id: "11111111-1111-4111-8111-111111111111",
      status: "ativa",
      next_charge_at: "2026-12-01T12:00:00.000Z",
      created_at: "2026-10-01T12:00:00.000Z",
      ...over,
    } as AssinaturaLinha["subscription"],
    planName: "Plano Mensal",
    planAmountCents: 9900,
    billingPeriod: "mensal",
    customerName: "Maria Silva",
    customerOptIn: true,
  };
}

/** Builder thenable: select/eq/order/limit encadeáveis. */
function chain(data: unknown) {
  const builder = {} as Record<string, (...a: never[]) => unknown>;
  for (const metodo of ["select", "eq", "order", "limit"] as const) {
    builder[metodo] = () => builder;
  }
  builder["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

function mockSupabase(auditRows: unknown[], charges: unknown[] = []) {
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "audit_log") return chain(auditRows);
    if (tabela === "membership_charges") return chain(charges);
    return chain([]);
  });
}

function renderDrawer(l: AssinaturaLinha) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssinaturaDrawer linha={l} aberto aoAlterarAberto={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssinaturaDrawer — correções review (motivo, inadimplente)", () => {
  it("exibe motivo de metadata.reason (contrato servidor)", async () => {
    mockSupabase([
      {
        id: "e1",
        tenant_id: "t1",
        actor_id: "u1",
        action: "membership_status_changed",
        target_type: "membership_subscription",
        target_id: SUB_ID,
        metadata: { to_status: "cancelada", reason: "Cliente pediu" },
        created_at: "2026-11-01T10:00:00.000Z",
      },
    ]);
    renderDrawer(linha());
    await waitFor(() =>
      expect(screen.getByText(/motivo: Cliente pediu/)).toBeTruthy(),
    );
  });

  it("fallback para metadata.motivo legado", async () => {
    mockSupabase([
      {
        id: "e2",
        tenant_id: "t1",
        actor_id: "u1",
        action: "membership_status_changed",
        target_type: "membership_subscription",
        target_id: SUB_ID,
        metadata: { motivo: "legado xyz" },
        created_at: "2026-11-01T10:00:00.000Z",
      },
    ]);
    renderDrawer(linha());
    await waitFor(() =>
      expect(screen.getByText(/motivo: legado xyz/)).toBeTruthy(),
    );
  });

  it("inadimplente oculta pausar/retomar e exibe regularizar", async () => {
    mockSupabase([]);
    renderDrawer(linha({ status: "inadimplente" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /regularizar/i }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: /^pausar$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^retomar$/i })).toBeNull();
  });

  it("ativa exibe pausar e não exibe regularizar", async () => {
    mockSupabase([]);
    renderDrawer(linha({ status: "ativa" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^pausar$/i })).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", { name: /regularizar/i }),
    ).toBeNull();
  });

  it("auditoria filtra server-side por target_id", async () => {
    const eqSpy = vi.fn();
    fromMock.mockImplementation((tabela: string) => {
      if (tabela === "audit_log") {
        const builder = chain([]);
        builder["eq"] = (...a: never[]) => {
          eqSpy(...a);
          return builder;
        };
        return builder;
      }
      return chain([]);
    });
    renderDrawer(linha());
    await waitFor(() => expect(eqSpy).toHaveBeenCalledWith("target_id", SUB_ID));
  });
});
