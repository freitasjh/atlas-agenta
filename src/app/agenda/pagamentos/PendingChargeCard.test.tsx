// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PendingChargeCard } from "@/app/agenda/pagamentos/PendingChargeCard";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";
import type { PendingCharge } from "@/types/payments";

afterEach(cleanup);

const CHARGE: PendingCharge = {
  id: "ch-1",
  amount_cents: 3000,
  expires_at: "2026-11-09T12:00:00.000Z",
  pix_qr_code: "qr",
  pix_copy_paste: "code",
};

function renderCard(charge: PendingCharge = CHARGE, overrides: Record<string, unknown> = {}) {
  const onShowQr = vi.fn();
  const onCancel = vi.fn();
  const onReissue = vi.fn();
  render(
    <PendingChargeCard
      charge={charge}
      canViewQr
      canCancel
      canReissue
      expired={false}
      onShowQr={onShowQr}
      onCancel={onCancel}
      onReissue={onReissue}
      messages={paymentsMessages}
      timeZone="America/Sao_Paulo"
      {...overrides}
    />,
  );
  return { onShowQr, onCancel, onReissue };
}

describe("PendingChargeCard", () => {
  it("com QR habilita 'Reexibir QR' e formata o valor", () => {
    renderCard();
    expect(screen.getByText("R$ 30,00")).toBeTruthy();
    const show = screen.getByRole("button", {
      name: paymentsMessages.settlement.showQr,
    });
    expect((show as HTMLButtonElement).disabled).toBe(false);
  });

  it("sem QR mostra 'PIX não gerado' e retry, sem img", () => {
    renderCard({ ...CHARGE, pix_qr_code: null, pix_copy_paste: null });
    expect(screen.getByText(paymentsMessages.settlement.noQr)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: paymentsMessages.settlement.showQr }),
    ).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("expirada mostra Expirado e Reemitir", () => {
    renderCard(CHARGE, { expired: true });
    expect(screen.getByText(paymentsMessages.settlement.expired)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: paymentsMessages.settlement.reissue }),
    ).toBeTruthy();
  });

  it("ações respeitam as permissões do servidor", () => {
    renderCard(CHARGE, { canViewQr: false, canCancel: false, canReissue: false });
    expect(
      screen.queryByRole("button", { name: paymentsMessages.settlement.showQr }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: paymentsMessages.settlement.cancelCharge,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: paymentsMessages.settlement.reissue }),
    ).toBeNull();
  });

  it("dispara callbacks", () => {
    const { onShowQr, onCancel } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.settlement.showQr }));
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.settlement.cancelCharge }),
    );
    expect(onShowQr).toHaveBeenCalledWith(CHARGE);
    expect(onCancel).toHaveBeenCalledWith(CHARGE);
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    renderCard(CHARGE, { messages: m });
    expect(
      screen.getByRole("button", { name: m.settlement.showQr }),
    ).toBeTruthy();
    expect(
      screen.queryByText(paymentsMessages.settlement.showQr),
    ).toBeNull();
  });
});
