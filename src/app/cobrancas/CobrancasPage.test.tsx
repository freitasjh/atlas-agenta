// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CobrancasPage } from "@/app/cobrancas/CobrancasPage";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

const mocks = vi.hoisted(() => ({
  charges: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
}));

vi.mock("@/hooks/useCharges", () => ({
  useCharges: () => mocks.charges,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canViewFinancials: false }),
}));
vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ payments: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, children),
    );
  render(createElement(CobrancasPage), { wrapper });
}

const CHARGE = {
  id: "c-1",
  tenant_id: "t-1",
  appointment_id: "a-1",
  asaas_payment_id: "pay-1",
  status: "pendente",
  amount_cents: 3000,
  pix_qr_code: "qr-base64",
  pix_copy_paste: "00020126",
  expires_at: "2026-12-01T00:00:00.000Z",
  paid_at: null,
  created_at: "2026-11-06T12:00:00.000Z",
};

beforeEach(() => {
  mocks.charges.data = [CHARGE];
  mocks.charges.isLoading = false;
  mocks.charges.isError = false;
  mocks.charges.refetch.mockReset();
});

afterEach(cleanup);

describe("CobrancasPage", () => {
  it("usa copy do catálogo e formata o valor com formatCentsToBRL", () => {
    renderPage();
    expect(screen.getByText(paymentsMessages.chargesPage.title)).toBeTruthy();
    expect(screen.getByText(paymentsMessages.chargesPage.description)).toBeTruthy();
    expect(screen.getByText("R$ 30,00")).toBeTruthy();
    expect(screen.getByText(paymentsMessages.chargesPage.status.pendente)).toBeTruthy();
  });

  it("não mantém formatCents local (usa o helper compartilhado)", () => {
    const source = readFileSync("src/app/cobrancas/CobrancasPage.tsx", "utf8");
    expect(/formatCents\s*\(/.test(source)).toBe(false);
  });

  it("estado vazio usa o catálogo", () => {
    mocks.charges.data = [];
    renderPage();
    expect(screen.getByText(paymentsMessages.chargesPage.emptyTitle)).toBeTruthy();
  });

  it("erro mostra título/descrição do catálogo e oferece retry", () => {
    mocks.charges.isError = true;
    mocks.charges.refetch.mockReset();
    renderPage();
    expect(screen.getByText(paymentsMessages.chargesPage.errorTitle)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.chargesPage.retry }),
    );
    expect(mocks.charges.refetch).toHaveBeenCalledTimes(1);
  });

  it("rótulos de filtro ligados aos campos e data no fuso do tenant", () => {
    renderPage();
    expect(
      screen.getByLabelText(paymentsMessages.chargesPage.filters.status),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(paymentsMessages.chargesPage.filters.from),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(paymentsMessages.chargesPage.filters.to),
    ).toBeTruthy();
    expect(screen.getByText("06/11/2026 09:00")).toBeTruthy();
  });

  it("abre o QR no PixQrDialog extraído, delegando ao PixQrPanel", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.chargesPage.actionQr }),
    );
    expect(screen.getByTestId("pix-qr-dialog")).toBeTruthy();
    expect(screen.getByTestId("pix-qr-panel")).toBeTruthy();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
