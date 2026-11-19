// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => (globalThis as { __tenant?: unknown }).__tenant,
}));

function setTenant(tenant: unknown) {
  (globalThis as { __tenant?: unknown }).__tenant = {
    isLoadingAuth: false,
    tenant,
  };
}

/**
 * Linhas do catálogo espelhando o seed SSoT pós-rename (migration
 * `20261115000000_plan_rename_ladder.sql` + Fase 3/4 + Fase 5 ADR-01
 * `20261204090000_plan_catalog_fase5_features.sql`): slugs reais
 * `free/starter/premium/enterprise` — nunca os antigos
 * `individual/clinica/pro`.
 */
const CATALOG_ROWS = [
  {
    slug: "free",
    name: "Free",
    price_cents: 0,
    prof_limit: 1,
    appt_limit: 30,
    features: ["agendamento"],
    active: true,
    sort_order: 1,
  },
  {
    slug: "starter",
    name: "Starter",
    price_cents: 5900,
    prof_limit: 1,
    appt_limit: 150,
    features: [
      "agendamento",
      "pdv_checkout",
      "cobranca_pix",
      "whatsapp",
      "comissao_profissional",
      "relatorios",
    ],
    active: true,
    sort_order: 2,
  },
  {
    slug: "premium",
    name: "Premium",
    price_cents: 14900,
    prof_limit: 5,
    appt_limit: null,
    features: [
      "agendamento",
      "pdv_checkout",
      "cobranca_pix",
      "whatsapp",
      "comissao_profissional",
      "combos_pacotes",
      "prontuario",
      "pacotes_sessoes",
      "estoque_backbar",
      "estoque",
      "comissao_produto",
      "deposito",
      "waitlist",
      "campanhas",
      "fidelidade",
      "checkout_self_service",
      "nfce",
      "recorrencia",
      "contas_pagar",
      "conciliacao",
      "dre_fluxo",
      "export_contabil",
      "backoffice_t14",
      "backoffice_t15",
      "relatorios",
    ],
    active: true,
    sort_order: 3,
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    price_cents: 25900,
    prof_limit: null,
    appt_limit: null,
    features: [
      "agendamento",
      "pdv_checkout",
      "cobranca_pix",
      "whatsapp",
      "comissao_profissional",
      "combos_pacotes",
      "prontuario",
      "pacotes_sessoes",
      "estoque_backbar",
      "estoque",
      "comissao_produto",
      "deposito",
      "waitlist",
      "campanhas",
      "fidelidade",
      "checkout_self_service",
      "nfce",
      "recorrencia",
      "contas_pagar",
      "conciliacao",
      "dre_fluxo",
      "export_contabil",
      "backoffice_t14",
      "backoffice_t15",
      "multi_unidade",
      "relatorios",
    ],
    active: true,
    sort_order: 4,
  },
];

const ALL_FALSE = {
  prontuario: false,
  pacotes: false,
  aestheticCheckout: false,
  estoque: false,
  comissaoProduto: false,
  deposito: false,
  waitlist: false,
  campanhas: false,
  fidelidade: false,
  checkoutSelfService: false,
  nfce: false,
  recorrencia: false,
  contasPagar: false,
  conciliacao: false,
  dreFluxo: false,
  exportContabil: false,
  backofficeT14: false,
  backofficeT15: false,
};

const ALL_TRUE = Object.fromEntries(
  Object.keys(ALL_FALSE).map((key) => [key, true]),
);

const SORTED_KEYS = Object.keys(ALL_FALSE).sort();

function renderEntitlements() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const { result } = renderHook(() => usePlanEntitlements(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return result;
}

describe("usePlanEntitlements — contrato congelado Fase 5 (ADR-01, 18 chaves)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("retorna null sem tenant (degrada sem travar, nunca lança)", () => {
    setTenant(null);
    const result = renderEntitlements();
    expect(result.current).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("retorna null quando o tenant não carrega entitlements nem plano", () => {
    setTenant({ timezone: "America/Sao_Paulo" });
    const result = renderEntitlements();
    expect(result.current).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("resolve as 18 chaves exatas quando o tenant expõe entitlements válidos", () => {
    setTenant({
      timezone: "America/Sao_Paulo",
      entitlements: { ...ALL_FALSE, nfce: true, dreFluxo: true },
    });
    const result = renderEntitlements();
    expect(result.current).toEqual({
      ...ALL_FALSE,
      nfce: true,
      dreFluxo: true,
    });
    expect(Object.keys(result.current ?? {}).sort()).toEqual(SORTED_KEYS);
  });

  it.each([
    ["tipo errado", { prontuario: "sim", pacotes: false, aestheticCheckout: true }],
    ["chave faltante", { prontuario: true, pacotes: false }],
    ["entitlements nulo", null],
    ["entitlements não-objeto", "plano-cheio"],
    ["booleano ausente (undefined)", undefined],
    [
      "payload legado T1.2 (10 chaves, sem as 8 da Fase 5)",
      {
        prontuario: true,
        pacotes: true,
        aestheticCheckout: true,
        estoque: true,
        comissaoProduto: true,
        deposito: true,
        waitlist: true,
        campanhas: true,
        fidelidade: true,
        checkoutSelfService: true,
      },
    ],
  ])("dado sujo vira null sem lançar (%s)", (_rotulo, entitlements) => {
    setTenant({ timezone: "America/Sao_Paulo", entitlements });
    let value: unknown = "lançou";
    expect(() => {
      const result = renderEntitlements();
      value = result.current;
    }).not.toThrow();
    expect(value).toBeNull();
  });

  it("ignora chaves extras mantendo o contrato exato de 18 chaves", () => {
    setTenant({
      timezone: "America/Sao_Paulo",
      entitlements: { ...ALL_TRUE, planoVip: true },
    });
    const result = renderEntitlements();
    expect(result.current).toEqual(ALL_TRUE);
    expect(Object.keys(result.current ?? {}).sort()).toEqual(SORTED_KEYS);
  });

  it("tenant.entitlements tem precedência sobre o catálogo (T1.x futuro)", async () => {
    rpcMock.mockResolvedValueOnce({ data: CATALOG_ROWS, error: null });
    setTenant({
      timezone: "America/Sao_Paulo",
      plan: "premium",
      entitlements: { ...ALL_FALSE },
    });
    const result = renderEntitlements();
    expect(result.current).toEqual(ALL_FALSE);
    // Catálogo nem é consultado quando o T1.x já resolveu.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("resolve pelo catálogo: premium → tudo true (18 chaves)", async () => {
    rpcMock.mockResolvedValueOnce({ data: CATALOG_ROWS, error: null });
    setTenant({ timezone: "America/Sao_Paulo", plan: "premium" });
    const result = renderEntitlements();
    await waitFor(() => expect(result.current).toEqual(ALL_TRUE));
    expect(rpcMock).toHaveBeenCalledWith("get_plans");
  });

  it("resolve pelo catálogo: enterprise → tudo true (18 chaves)", async () => {
    rpcMock.mockResolvedValueOnce({ data: CATALOG_ROWS, error: null });
    setTenant({ timezone: "America/Sao_Paulo", plan: "enterprise" });
    const result = renderEntitlements();
    await waitFor(() => expect(result.current).toEqual(ALL_TRUE));
  });

  it("resolve pelo catálogo: free → tudo false (18 chaves)", async () => {
    rpcMock.mockResolvedValueOnce({ data: CATALOG_ROWS, error: null });
    setTenant({ timezone: "America/Sao_Paulo", plan: "free" });
    const result = renderEntitlements();
    await waitFor(() => expect(result.current).toEqual(ALL_FALSE));
  });

  it("resolve pelo catálogo: starter → só checkout (sem Fase 4/5)", async () => {
    rpcMock.mockResolvedValueOnce({ data: CATALOG_ROWS, error: null });
    setTenant({ timezone: "America/Sao_Paulo", plan: "starter" });
    const result = renderEntitlements();
    await waitFor(() =>
      expect(result.current).toEqual({
        ...ALL_FALSE,
        aestheticCheckout: true,
      }),
    );
  });

  it("cada flag nova da Fase 5 liga só a sua chave (mapeamento 1:1)", async () => {
    const pairs: [string, string][] = [
      ["nfce", "nfce"],
      ["recorrencia", "recorrencia"],
      ["contas_pagar", "contasPagar"],
      ["conciliacao", "conciliacao"],
      ["dre_fluxo", "dreFluxo"],
      ["export_contabil", "exportContabil"],
      ["backoffice_t14", "backofficeT14"],
      ["backoffice_t15", "backofficeT15"],
    ];
    for (const [flag, key] of pairs) {
      rpcMock.mockResolvedValueOnce({
        data: [
          {
            slug: "custom",
            name: "Custom",
            price_cents: 100,
            prof_limit: 1,
            appt_limit: 10,
            features: [flag],
            active: true,
            sort_order: 1,
          },
        ],
        error: null,
      });
      setTenant({ timezone: "America/Sao_Paulo", plan: "custom" });
      const result = renderEntitlements();
      await waitFor(() =>
        expect(result.current).toEqual({ ...ALL_FALSE, [key]: true }),
      );
      cleanup();
    }
  });

  it("features fora do contrato não ligam nenhuma chave", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          slug: "custom",
          name: "Custom",
          price_cents: 100,
          prof_limit: 1,
          appt_limit: 10,
          features: ["relatorios", "multi_unidade", "agendamento"],
          active: true,
          sort_order: 1,
        },
      ],
      error: null,
    });
    setTenant({ timezone: "America/Sao_Paulo", plan: "custom" });
    const result = renderEntitlements();
    await waitFor(() => expect(result.current).toEqual(ALL_FALSE));
  });

  it("plano desconhecido (slug legado ou fora do catálogo) → null", async () => {
    rpcMock.mockResolvedValueOnce({ data: CATALOG_ROWS, error: null });
    setTenant({ timezone: "America/Sao_Paulo", plan: "clinica" });
    const result = renderEntitlements();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("plano inativo no catálogo → null", async () => {
    rpcMock.mockResolvedValueOnce({
      data: CATALOG_ROWS.map((row) =>
        row.slug === "premium" ? { ...row, active: false } : row,
      ),
      error: null,
    });
    setTenant({ timezone: "America/Sao_Paulo", plan: "premium" });
    const result = renderEntitlements();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("loading do catálogo → null (degrada sem travar)", () => {
    rpcMock.mockReturnValueOnce(new Promise(() => {}));
    setTenant({ timezone: "America/Sao_Paulo", plan: "premium" });
    const result = renderEntitlements();
    expect(result.current).toBeNull();
  });

  it("falha de rede no catálogo → null (degrada, nunca lança)", async () => {
    rpcMock.mockRejectedValueOnce(new Error("network down"));
    setTenant({ timezone: "America/Sao_Paulo", plan: "premium" });
    let result: { current: unknown } | null = null;
    expect(() => {
      result = renderEntitlements();
    }).not.toThrow();
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_plans"));
    await waitFor(() => expect(result?.current).toBeNull());
  });
});
