// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanBadge } from "@/app/agenda/PlanBadge";
import type { AestheticEntitlements } from "@/hooks/usePlanEntitlements";

const mocks = vi.hoisted(() => ({
  entitlements: null as AestheticEntitlements | null,
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

afterEach(cleanup);

function renderBadge() {
  return render(
    <MemoryRouter>
      <PlanBadge />
    </MemoryRouter>,
  );
}

describe("PlanBadge — gating T1.2 (ADR-01)", () => {
  it("degrada sem entitlements sem travar a agenda (nenhum throw)", () => {
    mocks.entitlements = null;
    const { container } = renderBadge();
    expect(container.innerHTML).toBe("");
  });

  it("sem nenhum recurso liberado exibe upsell para /precos (nunca hide silencioso)", () => {
    mocks.entitlements = {
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
    renderBadge();
    const link = screen.getByRole("link", { name: /ver planos/i });
    expect(link.getAttribute("href")).toBe("/precos");
  });

  it("com recurso liberado exibe atalho para /app/config/plano", () => {
    mocks.entitlements = {
      prontuario: true,
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
    renderBadge();
    const link = screen.getByRole("link", { name: /ver detalhes/i });
    expect(link.getAttribute("href")).toBe("/app/config/plano");
  });
});
