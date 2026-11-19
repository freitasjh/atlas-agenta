// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OperacaoTab } from "@/internal-admin/empresas/OperacaoTab";
import type { TenantListItem } from "@/types/domain";

const { rpcMock, fromMock, invokeMock, toastMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

function catalog(features: string[]) {
  return [
    {
      slug: "enterprise",
      name: "Enterprise",
      price_cents: 25900,
      prof_limit: null,
      appt_limit: null,
      features,
      active: true,
      sort_order: 4,
    },
  ];
}

const TENANT_ATIVO: TenantListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  trade_name: "Studio Alfa",
  legal_name: "Alfa LTDA",
  document: null,
  owner_email: "alfa@exemplo.com",
  plan: "premium",
  subscription_status: "ativo",
  trial_ends_at: null,
  timezone: "America/Sao_Paulo",
  created_at: "2026-01-01T00:00:00.000Z",
};

const TENANT_BLOQUEADO: TenantListItem = {
  ...TENANT_ATIVO,
  id: "22222222-2222-4222-8222-222222222222",
  trade_name: "Barbearia Beta",
  subscription_status: "bloqueado",
};

const ASSINATURA = {
  tenant_id: TENANT_ATIVO.id,
  tenant_name: "Studio Alfa",
  subscription_id: "33333333-3333-4333-8333-333333333333",
  customer_name: "Cliente Inadimplente",
  plan_name: "Mensal Essencial",
  billing_period: "mensal",
  amount_cents: 9900,
  status: "inadimplente",
  next_charge_at: null,
  overdue_charges: 2,
  overdue_amount_cents: 19800,
};

const AUDITORIA = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    tenant_id: TENANT_BLOQUEADO.id,
    changed_by: "55555555-5555-4555-8555-555555555555",
    old_status: "ativo",
    new_status: "bloqueado",
    reason: "inadimplencia confirmada",
    created_at: "2026-11-01T12:00:00.000Z",
  },
];

/**
 * Builder mínimo das queries PostgREST usadas na tela:
 * - `tenants` → `.select().order()` (await direto)
 * - `subscription_status_changes` → `.select().order().limit()`
 */
function fromBuilder(table: string) {
  const result =
    table === "tenants"
      ? Promise.resolve({ data: [TENANT_ATIVO, TENANT_BLOQUEADO], error: null })
      : Promise.resolve({ data: AUDITORIA, error: null });

  const terminal = {
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => result.then(onFulfilled, onRejected),
  };

  const afterOrder =
    table === "tenants" ? terminal : { limit: () => result };

  const builder = {
    select: () => builder,
    order: () => afterOrder,
    limit: () => result,
  };
  return builder;
}

function wrapper(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockRpc(t14 = true) {
  rpcMock.mockImplementation((name: string) => {
    if (name === "get_plans") {
      return Promise.resolve({
        data: catalog(t14 ? ["backoffice_t14", "backoffice_t15"] : ["agendamento"]),
        error: null,
      });
    }
    if (name === "backoffice_subscriptions") {
      return Promise.resolve({ data: [ASSINATURA], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

describe("OperacaoTab (ADR-11 T1.4)", () => {
  beforeEach(() => {
    fromMock.mockImplementation((table: string) => fromBuilder(table));
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        tenant_id: TENANT_ATIVO.id,
        old_status: "ativo",
        new_status: "bloqueado",
      },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    rpcMock.mockReset();
    fromMock.mockReset();
    invokeMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("gating false bloqueia legível e NÃO consulta dados do back-office", async () => {
    mockRpc(false);
    render(wrapper(<OperacaoTab />));

    await waitFor(() =>
      expect(screen.getByText(/recurso não incluído no plano atual/i)).toBeDefined(),
    );
    const chamadas = rpcMock.mock.calls.map((call) => call[0]);
    expect(chamadas).toContain("get_plans");
    expect(chamadas).not.toContain("backoffice_subscriptions");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("falha de rede no gating mostra verificação com retry, não 'não incluído'", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_plans") {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      return Promise.resolve({ data: null, error: null });
    });
    render(wrapper(<OperacaoTab />));

    await waitFor(() =>
      expect(
        screen.getByText(/Não foi possível verificar o acesso ao back-office/i),
      ).toBeDefined(),
    );
    expect(screen.queryByText(/recurso não incluído no plano atual/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeDefined();
    expect(fromMock).not.toHaveBeenCalled();
    expect(
      rpcMock.mock.calls.map((call) => call[0]),
    ).not.toContain("backoffice_subscriptions");
  });

  it("mostra assinatura inadimplente cross-tenant e valor vencido", async () => {
    mockRpc();
    render(wrapper(<OperacaoTab />));

    await waitFor(() =>
      expect(screen.getAllByText("Cliente Inadimplente").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Studio Alfa").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/1 assinatura\(s\) de cliente com inadimplência/i),
    ).toBeDefined();
    expect(screen.getAllByText(/198,00/).length).toBeGreaterThan(0);
  });

  it("oferece suspender em empresa ativa e retomar em empresa bloqueada", async () => {
    mockRpc();
    render(wrapper(<OperacaoTab />));

    await waitFor(() =>
      expect(screen.getAllByText("Studio Alfa").length).toBeGreaterThan(0),
    );

    const suspender = screen.getAllByRole("button", {
      name: "Suspender",
    }) as HTMLButtonElement[];
    const retomar = screen.getAllByRole("button", {
      name: "Retomar",
    }) as HTMLButtonElement[];
    expect(suspender.some((b) => !b.disabled)).toBe(true);
    expect(suspender.some((b) => b.disabled)).toBe(true);
    expect(retomar.some((b) => !b.disabled)).toBe(true);
    expect(retomar.some((b) => b.disabled)).toBe(true);
  });

  it("motivo é obrigatório: sem motivo não chama a Edge Function", async () => {
    mockRpc();
    render(wrapper(<OperacaoTab />));

    await waitFor(() =>
      expect(screen.getAllByText("Studio Alfa").length).toBeGreaterThan(0),
    );

    const suspender = screen
      .getAllByRole("button", { name: "Suspender" })
      .find((b) => !(b as HTMLButtonElement).disabled) as HTMLButtonElement;
    fireEvent.click(suspender);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Suspender empresa" }));

    await waitFor(() =>
      expect(screen.getByText("Informe o motivo da operação.")).toBeDefined(),
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("com motivo, suspende via Edge Function auditada (status bloqueado)", async () => {
    mockRpc();
    render(wrapper(<OperacaoTab />));

    await waitFor(() =>
      expect(screen.getAllByText("Studio Alfa").length).toBeGreaterThan(0),
    );

    const suspender = screen
      .getAllByRole("button", { name: "Suspender" })
      .find((b) => !(b as HTMLButtonElement).disabled) as HTMLButtonElement;
    fireEvent.click(suspender);

    const motivo = await screen.findByLabelText(/Motivo \(obrigatório\)/i);
    fireEvent.change(motivo, {
      target: { value: "inadimplencia confirmada pelo financeiro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suspender empresa" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    const [fn, options] = invokeMock.mock.calls[0] as [
      string,
      { body: { action: string; tenantId: string; status: string; reason: string } },
    ];
    expect(fn).toBe("admin-subscription");
    expect(options.body.action).toBe("set_status");
    expect(options.body.tenantId).toBe(TENANT_ATIVO.id);
    expect(options.body.status).toBe("bloqueado");
    expect(options.body.reason).toBe("inadimplencia confirmada pelo financeiro");
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Empresa suspensa."),
    );
  });

  it("mostra a trilha de auditoria com motivo registrado", async () => {
    mockRpc();
    render(wrapper(<OperacaoTab />));

    await waitFor(() =>
      expect(screen.getAllByText("inadimplencia confirmada").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Ativo → Bloqueado").length).toBeGreaterThan(0);
  });
});
