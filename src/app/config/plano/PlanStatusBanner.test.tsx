// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanStatusBanner, PlanTrialNote } from "@/app/config/plano/PlanStatusBanner";

afterEach(cleanup);

function renderBanner(status: "bloqueado" | "cancelado" | "pendente" | "ativo" | "trial" | null) {
  return render(
    <MemoryRouter>
      <PlanStatusBanner status={status} onCheckStatus={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("PlanStatusBanner (RF-36)", () => {
  it("whenBloqueado_thenShowsQuitacaoAlert", () => {
    renderBanner("bloqueado");
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Conta bloqueada/)).toBeDefined();
    expect(screen.getByText(/Ver fatura em aberto/)).toBeDefined();
  });

  it("whenCancelado_thenShowsReativacaoAlert", () => {
    renderBanner("cancelado");
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Assinatura cancelada/)).toBeDefined();
    expect(screen.getByText(/Reativar assinatura/)).toBeDefined();
  });

  it("whenPendente_thenShowsAguardandoPagamento", () => {
    renderBanner("pendente");
    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.getByText(/Pagamento pendente/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Verificar status/ }),
    ).toBeDefined();
  });

  it("whenAtivo_thenRendersNothing", () => {
    const { container } = renderBanner("ativo");
    expect(container.textContent).toBe("");
  });

  it("whenTrial_thenShowsUpsellNote", () => {
    render(
      <MemoryRouter>
        <PlanTrialNote />
      </MemoryRouter>,
    );
    expect(screen.getByText(/período de teste/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Ver planos/ }).getAttribute("href"),
    ).toBe("/precos");
  });
});
