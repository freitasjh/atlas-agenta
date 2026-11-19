// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrePage } from "@/app/financeiro/dre/DrePage";

const { entitlementsMock, rpcMock, toastMock, segmentMock } = vi.hoisted(() => ({
  entitlementsMock: vi.fn(),
  rpcMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  segmentMock: vi.fn(),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock(),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => segmentMock(),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const RELATORIO_COMPETENCIA = {
  regime: "competencia",
  ini: "2026-01-01T03:00:00.000Z",
  fim: "2026-02-01T03:00:00.000Z",
  receitas: {
    total_cents: 46_000,
    grupos: [
      { categoria: "Atendimentos", valor_cents: 30_000 },
      { categoria: "Receitas avulsas", valor_cents: 7_000 },
      { categoria: "Recorrência", valor_cents: 9_000 },
    ],
  },
  custos: { total_cents: 2_500, grupos: [{ categoria: "Comissões", valor_cents: 2_500 }] },
  margem_cents: 43_500,
  despesas: { total_cents: 4_000, grupos: [{ categoria: "aluguel", valor_cents: 4_000 }] },
  resultado_cents: 39_500,
  gorjeta_ignorada_cents: 3_000,
  meses: [
    {
      mes: "2025-12",
      receitas_cents: 20_000,
      custos_cents: 1_000,
      despesas_cents: 2_000,
      resultado_cents: 17_000,
    },
    {
      mes: "2026-01",
      receitas_cents: 46_000,
      custos_cents: 2_500,
      despesas_cents: 4_000,
      resultado_cents: 39_500,
    },
  ],
};

const RELATORIO_CAIXA = {
  ...RELATORIO_COMPETENCIA,
  regime: "caixa",
  receitas: {
    total_cents: 36_000,
    grupos: [
      { categoria: "Atendimentos", valor_cents: 20_000 },
      { categoria: "Receitas avulsas", valor_cents: 7_000 },
      { categoria: "Recorrência", valor_cents: 9_000 },
    ],
  },
  custos: { total_cents: 2_000, grupos: [{ categoria: "Comissões", valor_cents: 2_000 }] },
  margem_cents: 34_000,
  resultado_cents: 30_000,
  meses: [
    {
      mes: "2025-12",
      receitas_cents: 20_000,
      custos_cents: 1_000,
      despesas_cents: 2_000,
      resultado_cents: 17_000,
    },
    {
      mes: "2026-01",
      receitas_cents: 36_000,
      custos_cents: 2_000,
      despesas_cents: 4_000,
      resultado_cents: 30_000,
    },
  ],
};

const FLUXO = {
  base: "2026-01-01",
  dias: [
    {
      dia: "2026-01-01",
      entradas_cents: 0,
      saidas_cents: 0,
      saldo_dia_cents: 0,
      saldo_acumulado_cents: 0,
    },
    {
      dia: "2026-01-02",
      entradas_cents: 20_000,
      saidas_cents: 4_000,
      saldo_dia_cents: 16_000,
      saldo_acumulado_cents: 16_000,
    },
  ],
  total_entradas_cents: 20_000,
  total_saidas_cents: 4_000,
  saldo_final_cents: 16_000,
};

function mockRpc() {
  rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === "dre_report") {
      return Promise.resolve({
        data: args.p_regime === "caixa" ? RELATORIO_CAIXA : RELATORIO_COMPETENCIA,
        error: null,
      });
    }
    if (fn === "cashflow_30d") return Promise.resolve({ data: FLUXO, error: null });
    if (fn === "export_log_create") {
      return Promise.resolve({ data: { id: "log-1", created_at: "2026-01-31T12:00:00.000Z" }, error: null });
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
        <DrePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DrePage — ADR-09 (gating, regime, tabela, gráfico + tabela, export)", () => {
  beforeEach(() => {
    entitlementsMock.mockReturnValue({ dreFluxo: true });
    segmentMock.mockReturnValue({ payments: true });
    mockRpc();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("gating dreFluxo=false → upsell legível e zero request", async () => {
    entitlementsMock.mockReturnValue({ dreFluxo: false });
    renderPage();

    expect(screen.getByText(/recurso não incluído no plano atual/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver planos" })).toBeTruthy();
    // Nenhum export acionável: o único botão com esse rótulo é o upsell desabilitado.
    const exportar = screen.queryAllByRole("button", { name: /Exportar CSV/ });
    expect(exportar).toHaveLength(1);
    expect(exportar[0].hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(rpcMock).not.toHaveBeenCalled());
  });

  it("gating dreFluxo=null → upsell sem travar e zero request", async () => {
    entitlementsMock.mockReturnValue(null);
    renderPage();
    expect(screen.getByText(/recurso não incluído no plano atual/)).toBeTruthy();
    await waitFor(() => expect(rpcMock).not.toHaveBeenCalled());
  });

  it("upsell read-only anuncia o export bloqueado, não uma escrita", async () => {
    entitlementsMock.mockReturnValue({ dreFluxo: false });
    renderPage();
    const botao = await screen.findByRole("button", { name: /Exportar CSV \(bloqueado\)/ });
    expect(botao.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/não projeta movimento/i)).toBeTruthy();
  });

  it("PRD §7: segmento sem payments → estado legível e zero request, mesmo com dreFluxo", async () => {
    segmentMock.mockReturnValue({ payments: false });
    renderPage();

    expect(
      screen.getByText(/DRE disponível para salões e barbearias/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Competência/ })).toBeNull();
    await waitFor(() => expect(rpcMock).not.toHaveBeenCalled());
  });

  it("PRD §7: payments ainda não resolvido (null) → carregando sem request", async () => {
    segmentMock.mockReturnValue({ payments: null });
    renderPage();

    expect(screen.getByText(/Carregando DRE e fluxo de caixa/)).toBeTruthy();
    await waitFor(() => expect(rpcMock).not.toHaveBeenCalled());
  });

  it("abre na série de 6 meses (preset padrão), não em 1 barra", async () => {
    renderPage();

    const seisMeses = await screen.findByRole("button", { name: "Últimos 6 meses" });
    expect(seisMeses.getAttribute("aria-pressed")).toBe("true");

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("dre_report", expect.anything()));
    const [, args] = rpcMock.mock.calls.find(([fn]) => fn === "dre_report") as [
      string,
      { p_ini: string; p_fim: string },
    ];
    const ini = new Date(args.p_ini);
    const fim = new Date(args.p_fim);
    const meses =
      (fim.getUTCFullYear() - ini.getUTCFullYear()) * 12 + (fim.getUTCMonth() - ini.getUTCMonth());
    expect(meses).toBe(6);
  });

  it("segmentado competência/caixa troca o regime da RPC", async () => {
    renderPage();

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "dre_report",
        expect.objectContaining({ p_regime: "competencia" }),
      ),
    );
    const caixa = screen.getByRole("button", { name: "Caixa" });
    expect(screen.getByRole("button", { name: "Competência" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(caixa.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(caixa);

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "dre_report",
        expect.objectContaining({ p_regime: "caixa" }),
      ),
    );
    expect(caixa.getAttribute("aria-pressed")).toBe("true");
  });

  it("tabela DRE mostra Receitas − Custos = Margem − Despesas = Resultado", async () => {
    renderPage();

    await screen.findByText("DRE do período");
    expect(screen.getAllByText("R$ 460,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 435,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("−R$ 40,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 395,00").length).toBeGreaterThan(0);
    // Avulsas e recorrência em categorias próprias (nunca somadas no ledger).
    expect(screen.getByText("Receitas avulsas")).toBeTruthy();
    expect(screen.getByText("Recorrência")).toBeTruthy();
    expect(screen.getByText("Comissões")).toBeTruthy();
    expect(screen.getByText("aluguel")).toBeTruthy();
    // Gorjeta informada fora dos totais.
    expect(screen.getByText(/Gorjetas recebidas no período: R\$ 30,00/)).toBeTruthy();
  });

  it("gráfico mensal tem tabela alternativa com os mesmos números", async () => {
    renderPage();

    expect(
      await screen.findByRole("img", { name: /Resultado mensal no regime/ }),
    ).toBeTruthy();
    expect(screen.getByText("Resultado por mês")).toBeTruthy();
    expect(screen.getByRole("table", { name: /Série mensal do resultado/ })).toBeTruthy();
    expect(screen.getByText("dez/2025")).toBeTruthy();
    expect(screen.getByText("jan/2026")).toBeTruthy();
    expect(screen.getAllByText("R$ 170,00").length).toBeGreaterThan(0);
    expect(screen.getByText("R$ 565,00")).toBeTruthy();
  });

  it("fluxo de 30 dias mostra entradas, saídas, saldo e tabela alternativa", async () => {
    renderPage();

    expect(
      await screen.findByRole("img", { name: /Fluxo de caixa dos próximos 30 dias/ }),
    ).toBeTruthy();
    expect(screen.getByText("Fluxo de caixa · 30 dias")).toBeTruthy();
    expect(screen.getByText("Saldo final:")).toBeTruthy();
    expect(screen.getAllByText("R$ 160,00").length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: /Fluxo diário dos 30 dias/ })).toBeTruthy();
    expect(screen.getByText("02/01")).toBeTruthy();
  });

  it("export CSV baixa o arquivo e registra em export_logs", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((() => "blob:dre") as typeof URL.createObjectURL);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    renderPage();
    await screen.findByText("DRE do período");

    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "export_log_create",
        expect.objectContaining({
          p_tipo: "dre",
          p_formato: "csv",
          p_arquivo_path: expect.stringMatching(
            /^dre-competencia-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
          ),
        }),
      ),
    );
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:dre");
    expect(toastMock.success).toHaveBeenCalledWith(
      "CSV exportado.",
      expect.objectContaining({ description: expect.stringMatching(/registrada/) }),
    );
  });
});
