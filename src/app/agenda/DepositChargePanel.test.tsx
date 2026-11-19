// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DepositChargePanel } from "@/app/agenda/DepositChargePanel";
import type { DepositCharge } from "@/lib/validations/deposit";

const mocks = vi.hoisted(() => ({
  canSendWhatsAppMessage: true,
  canCancelCharge: true,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canSendWhatsAppMessage: mocks.canSendWhatsAppMessage,
    canCancelCharge: mocks.canCancelCharge,
  }),
}));

afterEach(cleanup);

const CHARGE: DepositCharge = {
  id: "charge-1",
  status: "pendente",
  amountCents: 5000,
  pixQrCode: null,
  pixCopiaECola: "pix-teste-123",
  expiresAt: null,
};

function renderPanel() {
  return render(
    <DepositChargePanel
      charge={CHARGE}
      onResendQr={() => {}}
      onCancel={() => {}}
    />,
  );
}

describe("DepositChargePanel — ADR-12 / RF-06 + RBAC", () => {
  it("exibe valor e estado da cobrança", () => {
    mocks.canSendWhatsAppMessage = true;
    mocks.canCancelCharge = true;
    renderPanel();
    expect(screen.getByText(/R\$\s*50,00/)).toBeDefined();
    expect(screen.getByText("pendente")).toBeDefined();
  });

  it("com permissão: mostra reenviar QR e cancelar", () => {
    mocks.canSendWhatsAppMessage = true;
    mocks.canCancelCharge = true;
    renderPanel();
    expect(
      screen.getByRole("button", { name: /reenviar qr/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /cancelar cobrança/i }),
    ).toBeDefined();
  });

  it("sem permissão: oculta as ações, mantém leitura", () => {
    mocks.canSendWhatsAppMessage = false;
    mocks.canCancelCharge = false;
    renderPanel();
    expect(screen.queryByRole("button", { name: /reenviar qr/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /cancelar cobrança/i }),
    ).toBeNull();
    expect(screen.getByText(/depósito\/sinal/i)).toBeDefined();
    mocks.canSendWhatsAppMessage = true;
    mocks.canCancelCharge = true;
  });
});
