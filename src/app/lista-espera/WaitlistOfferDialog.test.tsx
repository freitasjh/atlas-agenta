// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WaitlistOfferDialog } from "@/app/lista-espera/WaitlistOfferDialog";
import { waitlistMessages } from "@/app/lista-espera/waitlist-messages";

afterEach(cleanup);

const messages = waitlistMessages;

function renderDialog(overrides = {}) {
  return render(
    <WaitlistOfferDialog
      open
      onOpenChange={vi.fn()}
      messages={messages}
      customerName="Maria Silva"
      slotLabel="Corte · João"
      expiresAt={new Date(Date.now() + 5 * 60 * 1000).toISOString()}
      confirming={false}
      declining={false}
      onConfirm={vi.fn()}
      onDecline={vi.fn()}
      onExpire={vi.fn()}
      {...overrides}
    />,
  );
}

describe("WaitlistOfferDialog", () => {
  it("exibe countdown MM:SS com papel timer e aria-label em pt-BR", () => {
    renderDialog();
    const timer = screen.getByRole("timer");
    expect(timer.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(timer.getAttribute("aria-label")).toMatch(/tempo restante/i);
  });

  it("Confirmar e Recusar disparam os callbacks", () => {
    const onConfirm = vi.fn();
    const onDecline = vi.fn();
    renderDialog({ onConfirm, onDecline });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("oferta expirada mostra estado expirado sem ações", () => {
    renderDialog({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(screen.getByText("Oferta expirada")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Recusar" })).toBeNull();
    // "Fechar" do footer + X nativo do DialogContent: pelo menos um existe.
    expect(screen.getAllByRole("button", { name: "Fechar" }).length).toBeGreaterThan(0);
  });

  it("desabilita ações durante a request", () => {
    renderDialog({ confirming: true });
    expect(screen.getByRole("button", { name: /confirmando/i })).toBeDefined();
    expect(
      (screen.getByRole("button", { name: /confirmando/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
