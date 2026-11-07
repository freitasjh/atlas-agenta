// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineConfirmStep } from "@/app/agenda/pagamentos/InlineConfirmStep";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";

afterEach(cleanup);

describe("InlineConfirmStep", () => {
  function renderStep(overrides: Partial<ComponentProps<typeof InlineConfirmStep>> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <InlineConfirmStep
        title="Confirmar?"
        description="Descrição"
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...overrides}
      />,
    );
    return { onConfirm, onCancel };
  }

  it("renderiza como grupo (nunca role=dialog) e foca o cancelar", () => {
    renderStep();
    expect(screen.getByRole("group")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancelar" }),
    );
  });

  it("Enter no formulário confirma uma única vez", () => {
    const { onConfirm } = renderStep();
    const form = screen.getByRole("group").querySelector("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("tone destructive usa o botão destrutivo e busy desabilita ambos", () => {
    renderStep({ tone: "destructive", busy: true });
    const confirm = screen.getByRole("button", {
      name: "Confirmar",
    }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", {
      name: "Cancelar",
    }) as HTMLButtonElement;
    expect(confirm.className).toContain("bg-destructive");
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it("data-testid configurável e children aceito", () => {
    renderStep({ testId: "confirm-void", children: <textarea aria-label="motivo" /> });
    expect(screen.getByTestId("confirm-void")).toBeTruthy();
    expect(screen.getByLabelText("motivo")).toBeTruthy();
  });

  it("usa exclusivamente os rótulos recebidos (sonda)", () => {
    const m = makeMessagesSpy();
    renderStep({
      title: m.partial.warning,
      description: m.dialog.subtitle,
      confirmLabel: m.actions.confirm,
      cancelLabel: m.actions.back,
    });
    expect(screen.getByText(m.partial.warning)).toBeTruthy();
    expect(screen.getByText(m.dialog.subtitle)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.partial.warning)).toBeNull();
  });
});
