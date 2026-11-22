// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MfaChallengeCard } from "@/components/shadcn/mfa/mfa-challenge-card";
import type { MfaUserContext } from "@/components/shadcn/mfa/mfa-types";

const totpOnly: MfaUserContext = {
  userId: "factor-1",
  userEmail: "",
  preferredMethod: "totp",
  availableMethods: ["totp"],
};

function renderCard(
  props: Partial<React.ComponentProps<typeof MfaChallengeCard>> = {},
) {
  return render(
    <MfaChallengeCard
      userContext={totpOnly}
      onVerify={vi.fn()}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("MfaChallengeCard — variante interna (TOTP)", () => {
  it("single-input mantém label, one-time-code, tabular-nums e CTA configurável", () => {
    renderCard({
      inputMode: "single",
      codeLabel: "Código de 6 dígitos",
      title: "Verificação em 2 etapas",
      description: "Digite o código do seu autenticador.",
      submitLabel: "Verificar código",
      submitClassName: "min-h-[44px]",
    });

    const input = screen.getByLabelText("Código de 6 dígitos");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.className).toContain("tabular-nums");
    expect(screen.getByText("Verificação em 2 etapas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verificar código" }).className).toContain(
      "min-h-[44px]",
    );
  });

  it("esconde trust-device e o seletor quando há só TOTP", () => {
    renderCard({ inputMode: "single", codeLabel: "Código", showTrustDevice: false });

    expect(screen.queryByLabelText(/não solicitar neste dispositivo/i)).toBeNull();
    expect(screen.queryByText(/tentar de outra forma/i)).toBeNull();
  });

  it("mantém trust-device no default (retrocompatibilidade)", () => {
    renderCard();
    expect(screen.getByLabelText(/não solicitar neste dispositivo/i)).toBeTruthy();
  });

  it("disabled bloqueia input e botão; footer recebe CTA de enroll e status", () => {
    renderCard({
      inputMode: "single",
      codeLabel: "Código de 6 dígitos",
      submitLabel: "Verificar código",
      disabled: true,
      showTrustDevice: false,
      footer: (
        <>
          <button type="button">Ativar autenticador</button>
          <p role="status">Bloqueado temporariamente após 5 tentativas.</p>
        </>
      ),
    });

    expect((screen.getByLabelText("Código de 6 dígitos") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Verificar código" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Ativar autenticador" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Bloqueado temporariamente");
  });

  it("propaga mensagem de erro do onVerify com aria-live assertivo", async () => {
    const onVerify = vi.fn().mockResolvedValue({
      success: false,
      message: "Código inválido. Restam 4 tentativas.",
    });
    renderCard({
      inputMode: "single",
      codeLabel: "Código de 6 dígitos",
      submitLabel: "Verificar código",
      showTrustDevice: false,
      onVerify,
    });

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verificar código" }));

    await screen.findByText(/Restam 4 tentativas/);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(onVerify).toHaveBeenCalledWith({
      code: "000000",
      method: "totp",
      trustDevice: false,
    });
  });

  it("single-input: Enter submete via <form noValidate> e chama onVerify", async () => {
    const onVerify = vi.fn().mockResolvedValue({ success: true });
    const { container } = renderCard({
      inputMode: "single",
      codeLabel: "Código de 6 dígitos",
      submitLabel: "Verificar código",
      showTrustDevice: false,
      onVerify,
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.hasAttribute("novalidate")).toBe(true);
    const submit = screen.getByRole("button", { name: "Verificar código" }) as HTMLButtonElement;
    expect(submit.type).toBe("submit");

    const input = screen.getByLabelText("Código de 6 dígitos");
    fireEvent.change(input, { target: { value: "123456" } });
    // happy-dom + user-event fazem submissão implícita ao pressionar Enter num
    // input de texto dentro de <form> com botão submit habilitado (validado).
    expect(submit.disabled).toBe(false);
    const user = userEvent.setup();
    input.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onVerify).toHaveBeenCalledTimes(1));
    expect(onVerify).toHaveBeenCalledWith({
      code: "123456",
      method: "totp",
      trustDevice: false,
    });
  });

  it("botões de navegação continuam type=button dentro da visão single-input", () => {
    renderCard({
      inputMode: "single",
      userContext: { ...totpOnly, availableMethods: ["totp", "sms"] },
      onCancel: vi.fn(),
    });

    expect(
      (screen.getByRole("button", { name: /voltar para o login/i }) as HTMLButtonElement).type,
    ).toBe("button");
    expect(
      (screen.getByRole("button", { name: /tentar de outra forma/i }) as HTMLButtonElement).type,
    ).toBe("button");
  });

  it("live region role=alert fica sempre montada, vazia quando não há erro", async () => {
    const onVerify = vi.fn().mockResolvedValue({
      success: false,
      message: "Código inválido.",
    });
    renderCard({ inputMode: "single", codeLabel: "Código", showTrustDevice: false, onVerify });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("aria-atomic")).toBe("true");

    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "111111" } });
    fireEvent.submit(screen.getByLabelText("Código").closest("form") as HTMLFormElement);

    await screen.findByText("Código inválido.");
    expect(screen.getByRole("alert").textContent).toContain("Código inválido.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("erro repetido refoca e seleciona o campo via requestAnimationFrame", async () => {
    const onVerify = vi.fn().mockResolvedValue({
      success: false,
      message: "Código inválido.",
    });
    renderCard({ inputMode: "single", codeLabel: "Código", showTrustDevice: false, onVerify });

    const input = screen.getByLabelText("Código") as HTMLInputElement;
    const form = input.closest("form") as HTMLFormElement;

    fireEvent.change(input, { target: { value: "111111" } });
    fireEvent.submit(form);
    await screen.findByText("Código inválido.");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // Segunda tentativa com a MESMA mensagem: setState não muda, mas o rAF refoca.
    input.blur();
    expect(document.activeElement).not.toBe(input);
    fireEvent.change(input, { target: { value: "222222" } });
    fireEvent.submit(form);
    await waitFor(() => expect(onVerify).toHaveBeenCalledTimes(2));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(document.activeElement).toBe(input);
  });
});
