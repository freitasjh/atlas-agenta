// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PixQrPanel } from "@/app/agenda/pagamentos/PixQrPanel";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(cleanup);

function renderPanel(overrides: Partial<ComponentProps<typeof PixQrPanel>> = {}) {
  const onCopyResult = vi.fn();
  render(
    <PixQrPanel
      qrCode="abc"
      copyPaste="00020126"
      expiresAt="2026-11-09T12:00:00.000Z"
      amountCents={3000}
      messages={paymentsMessages}
      timeZone="America/Sao_Paulo"
      onCopyResult={onCopyResult}
      {...overrides}
    />,
  );
  return { onCopyResult };
}

describe("PixQrPanel", () => {
  it("normaliza base64 puro para data URI e usa alt do catálogo", () => {
    renderPanel();
    const image = screen.getByRole("img", { name: paymentsMessages.pix.qrAlt });
    expect(image.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(image.className).toContain("bg-white");
    expect(screen.getByText("R$ 30,00")).toBeTruthy();
  });

  it("preserva data URI existente", () => {
    renderPanel({ qrCode: "data:image/png;base64,xyz" });
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "data:image/png;base64,xyz",
    );
  });

  it("sem QR mostra indisponível e não renderiza img", () => {
    renderPanel({ qrCode: null });
    expect(screen.getByText(paymentsMessages.pix.unavailable)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("copiar reporta ok", async () => {
    writeText.mockResolvedValue(undefined);
    const { onCopyResult } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.copy }));
    await waitFor(() => expect(onCopyResult).toHaveBeenCalledWith("ok"));
  });

  it("falha de clipboard reporta error", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { onCopyResult } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.copy }));
    await waitFor(() => expect(onCopyResult).toHaveBeenCalledWith("error"));
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    renderPanel({ messages: m });
    expect(screen.getByText(m.pix.copyLabel)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.pix.copyLabel)).toBeNull();
  });
});
