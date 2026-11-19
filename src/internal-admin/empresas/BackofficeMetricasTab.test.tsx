// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackofficeMetricasTab } from "@/internal-admin/empresas/BackofficeMetricasTab";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
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

const SAAS = {
  kind: "saas",
  as_of: "2026-11-14T12:00:00-03",
  mrr_cents: 25900,
  base_ativa: 1,
  by_plan: { premium: { base: 1, mrr_cents: 25900 } },
};

const MEMBERSHIP = {
  kind: "membership",
  from: "2026-10-15",
  to: "2026-11-14",
  mrr_cents: 9900,
  mrr_em_risco_cents: 4950,
  ativas: 1,
  inadimplentes: 1,
  pausadas: 0,
  canceladas_periodo: 1,
  base_inicio: 4,
  churn_pct: 25,
};

const NFCE = {
  kind: "nfce",
  from: "2026-10-15",
  to: "2026-11-14",
  autorizadas: 7,
  contingencia: 1,
  rejeitadas: 2,
  canceladas: 0,
  pendentes: 0,
  valor_autorizado_cents: 70000,
};

function mockRpc(entitled = true) {
  rpcMock.mockImplementation((name: string) => {
    if (name === "get_plans") {
      return Promise.resolve({
        data: catalog(entitled ? ["backoffice_t14", "backoffice_t15"] : ["agendamento"]),
        error: null,
      });
    }
    if (name === "mrr_report") return Promise.resolve({ data: SAAS, error: null });
    if (name === "membership_mrr_churn") {
      return Promise.resolve({ data: MEMBERSHIP, error: null });
    }
    if (name === "nfce_volume") return Promise.resolve({ data: NFCE, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

function wrapper(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("BackofficeMetricasTab (ADR-11 T1.5)", () => {
  afterEach(() => {
    cleanup();
    rpcMock.mockReset();
  });

  it("gating false bloqueia legível sem consultar métricas", async () => {
    mockRpc(false);
    render(wrapper(<BackofficeMetricasTab />));

    await waitFor(() =>
      expect(screen.getByText(/recurso não incluído no plano atual/i)).toBeDefined(),
    );
    const chamadas = rpcMock.mock.calls.map((call) => call[0]);
    expect(chamadas).toContain("get_plans");
    expect(chamadas).not.toContain("mrr_report");
    expect(chamadas).not.toContain("membership_mrr_churn");
    expect(chamadas).not.toContain("nfce_volume");
  });

  it("separa MRR SaaS de MRR membership e mostra churn/NFCe", async () => {
    mockRpc();
    render(wrapper(<BackofficeMetricasTab />));

    await waitFor(() => expect(screen.getByText("MRR SaaS")).toBeDefined());

    // SaaS: R$ 259,00 · membership: R$ 99,00 — valores independentes.
    expect(screen.getAllByText("R$ 259,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 99,00").length).toBeGreaterThan(0);
    expect(screen.getByText("25,0%")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(
      screen.getAllByText(/nunca são somadas|nunca é somado/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("R$ 358,00")).toBeNull();
  });

  it("envia período e consulta o MRR SaaS atual (sem mês)", async () => {
    mockRpc();
    render(wrapper(<BackofficeMetricasTab />));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("mrr_report"),
    );
    const from = (screen.getByLabelText("Início") as HTMLInputElement).value;
    const to = (screen.getByLabelText("Fim") as HTMLInputElement).value;
    expect(rpcMock).toHaveBeenCalledWith("membership_mrr_churn", {
      p_from: from,
      p_to: to,
    });
    expect(rpcMock).toHaveBeenCalledWith("nfce_volume", {
      p_from: from,
      p_to: to,
    });
  });

  it("falha de rede no gating mostra painel de verificação, não 'não incluído'", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_plans") {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      return Promise.resolve({ data: null, error: null });
    });
    render(wrapper(<BackofficeMetricasTab />));

    await waitFor(() =>
      expect(
        screen.getByText(/Não foi possível verificar o acesso ao back-office/i),
      ).toBeDefined(),
    );
    expect(screen.queryByText(/recurso não incluído no plano atual/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeDefined();
    const chamadas = rpcMock.mock.calls.map((call) => call[0]);
    expect(chamadas).not.toContain("mrr_report");
    expect(chamadas).not.toContain("membership_mrr_churn");
    expect(chamadas).not.toContain("nfce_volume");
  });

  it("período inválido bloqueia consulta de métricas", async () => {
    mockRpc();
    render(wrapper(<BackofficeMetricasTab />));

    await waitFor(() => expect(screen.getByText("MRR SaaS")).toBeDefined());
    const inicio = screen.getByLabelText("Início") as HTMLInputElement;
    fireEvent.change(inicio, { target: { value: "2099-01-01" } });

    await waitFor(() =>
      expect(screen.getByText("Período inválido")).toBeDefined(),
    );
    const chamadas = rpcMock.mock.calls.map((call) => call[0]);
    expect(chamadas.filter((c) => c === "nfce_volume").length).toBe(1);
  });

  it("erro nas RPCs mostra painel com retry", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_plans") {
        return Promise.resolve({
          data: catalog(["backoffice_t14", "backoffice_t15"]),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "boom" } });
    });
    render(wrapper(<BackofficeMetricasTab />));

    await waitFor(() =>
      expect(
        screen.getByText(/Não foi possível carregar as métricas do back-office/i),
      ).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeDefined();
  });
});
