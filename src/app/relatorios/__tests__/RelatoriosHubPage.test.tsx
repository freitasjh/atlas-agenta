// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelatoriosHubPage } from "@/app/relatorios/RelatoriosHubPage";

const mocks = vi.hoisted(() => ({
  canViewFinancials: true,
  canViewCommission: true,
  payments: true as boolean | null,
  commission: true as boolean | null,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canViewFinancials: mocks.canViewFinancials,
    canViewCommission: mocks.canViewCommission,
  }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({
    payments: mocks.payments,
    commission: mocks.commission,
  }),
}));

function renderHub() {
  return render(
    createElement(MemoryRouter, null, createElement(RelatoriosHubPage)),
  );
}

beforeEach(() => {
  mocks.canViewFinancials = true;
  mocks.canViewCommission = true;
  mocks.payments = true;
  mocks.commission = true;
});

afterEach(() => cleanup());

describe("RelatoriosHubPage (ADR-005 §4)", () => {
  it("admin de salão vê Comissões e Financeiro", () => {
    renderHub();
    expect(screen.getByText("Comissões")).toBeTruthy();
    expect(screen.getByText("Financeiro")).toBeTruthy();
    expect(
      screen.getByText("Recebido por forma, gorjeta, a receber e em aberto."),
    ).toBeTruthy();
  });

  it("sem finanças o card Financeiro some; sem nada, vazio honesto", () => {
    mocks.canViewFinancials = false;
    renderHub();
    expect(screen.queryByText("Financeiro")).toBeNull();
    expect(screen.getByText("Comissões")).toBeTruthy();
    cleanup();

    mocks.canViewCommission = false;
    mocks.commission = false;
    renderHub();
    expect(screen.queryByText("Financeiro")).toBeNull();
    expect(
      screen.getByText("Nenhum relatório disponível ainda"),
    ).toBeTruthy();
  });

  it("clínica (payments=false) não vê o Financeiro", () => {
    mocks.payments = false;
    renderHub();
    expect(screen.queryByText("Financeiro")).toBeNull();
  });
});
