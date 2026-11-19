// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FinanceiroHubPage } from "@/app/financeiro/FinanceiroHubPage";

const { entitlementsMock, rpcMock } = vi.hoisted(() => ({
  entitlementsMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, from: vi.fn() },
}));

function renderHub() {
  return render(
    <MemoryRouter>
      <FinanceiroHubPage />
    </MemoryRouter>,
  );
}

describe("FinanceiroHubPage — skeleton Fase 5 ADR-01 (só gating, sem tabelas)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("entitlements null → upsell legível e nenhum request a tabelas fase-5", () => {
    entitlementsMock.mockReturnValue(null);
    renderHub();
    expect(
      screen.getByRole("heading", { name: "Financeiro" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Ver planos" }).length).toBeGreaterThan(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sem nenhuma chave ligada → todas as capacidades mostram upsell, sem request", () => {
    entitlementsMock.mockReturnValue({
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
    });
    renderHub();
    for (const capacidade of [
      "Notas fiscais",
      "Assinaturas",
      "Contas a pagar",
      "Contas a receber",
      "Conciliação",
      "DRE e fluxo de caixa",
      "Exportar para o contador",
    ]) {
      expect(screen.getByText(capacidade)).toBeTruthy();
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("chaves ligadas → capacidades liberadas seguem sem request (skeleton, ADR-02+ implementa)", () => {
    entitlementsMock.mockReturnValue({
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
      nfce: true,
      recorrencia: true,
      contasPagar: true,
      conciliacao: true,
      dreFluxo: true,
      exportContabil: true,
      backofficeT14: false,
      backofficeT15: false,
    });
    renderHub();
    // Fase 5 completa: todas as 7 capacidades têm rota (ADR-10 fecha o export).
    expect(screen.queryByText("Em breve")).toBeNull();
    expect(screen.getByRole("link", { name: /Abrir exportar para o contador/i })).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
