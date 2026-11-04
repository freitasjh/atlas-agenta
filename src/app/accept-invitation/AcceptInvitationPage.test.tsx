// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AcceptInvitationPage } from "@/app/accept-invitation/AcceptInvitationPage";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

const VALID_TOKEN = "a".repeat(32);
const VALID_PASSWORD = "senha-segura-1";

function LoginProbe() {
  const location = useLocation();
  return createElement(
    "p",
    { "data-testid": "login-state" },
    JSON.stringify(location.state),
  );
}

function renderAccept(query: string) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [`/accept-invitation${query}`] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/accept-invitation",
          element: createElement(AcceptInvitationPage),
        }),
        createElement(Route, {
          path: "/login",
          element: createElement(LoginProbe),
        }),
      ),
    ),
  );
}

function fillPasswords(container: HTMLElement, password: string, confirm: string) {
  const inputs = container.querySelectorAll("input[type='password']");
  expect(inputs.length).toBe(2);
  fireEvent.change(inputs[0] as Element, { target: { value: password } });
  fireEvent.change(inputs[1] as Element, { target: { value: confirm } });
}

function submit(container: HTMLElement) {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AcceptInvitationPage — formulário de senha", () => {
  it("token ausente ⇒ erro sem formulário", () => {
    renderAccept("");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByLabelText(/senha/i)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("token curto ⇒ erro sem formulário", () => {
    renderAccept("?token=curto");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText(/senha/i)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("token válido ⇒ renderiza formulário de senha", () => {
    renderAccept(`?token=${VALID_TOKEN}`);
    expect(screen.getByLabelText("Senha")).toBeTruthy();
    expect(screen.getByLabelText("Confirmar senha")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /aceitar convite/i }),
    ).toBeTruthy();
  });

  it("senha curta ⇒ mensagem pt-BR e sem invoke", async () => {
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, "curta", "curta");
    submit(container);
    await screen.findByText(/ao menos 8 caracteres/i);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("senhas divergentes ⇒ mensagem pt-BR e sem invoke", async () => {
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, "outra-senha-2");
    submit(container);
    await screen.findByText(/não coincidem/i);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("submit válido ⇒ invoke com { token, password } e tela de sucesso com link /login + notice", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, role: "professional" }, error: null });
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, VALID_PASSWORD);
    submit(container);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock.mock.calls[0]?.[0]).toBe("accept-invitation");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { token: VALID_TOKEN, password: VALID_PASSWORD },
    });
    await screen.findByText(/convite aceito/i);
    fireEvent.click(screen.getByRole("link", { name: /ir para o login/i }));
    const probe = await screen.findByTestId("login-state");
    expect(JSON.parse(probe.textContent ?? "null")).toMatchObject({
      notice: expect.stringMatching(/convite aceito/i),
    });
  });

  it("role professional ⇒ copy 'veja sua agenda'", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, role: "professional" }, error: null });
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, VALID_PASSWORD);
    submit(container);
    expect(await screen.findByText(/veja sua agenda/i)).toBeTruthy();
  });

  it("role receptionist ⇒ copy 'veja sua agenda'", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, role: "receptionist" }, error: null });
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, VALID_PASSWORD);
    submit(container);
    expect(await screen.findByText(/veja sua agenda/i)).toBeTruthy();
  });

  it("role admin ⇒ copy 'gerencie sua empresa'", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, role: "admin" }, error: null });
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, VALID_PASSWORD);
    submit(container);
    expect(await screen.findByText(/gerencie sua empresa/i)).toBeTruthy();
  });

  it("role ausente (cliente antigo) ⇒ copy genérica", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, VALID_PASSWORD);
    submit(container);
    expect(
      await screen.findByText(/entre com seu e-mail e senha/i),
    ).toBeTruthy();
  });

  it("erro do servidor ⇒ alerta sem navegar", async () => {
    invokeMock.mockResolvedValue({
      data: { message: "Convite expirado." },
      error: { message: "invalid" },
    });
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, VALID_PASSWORD);
    submit(container);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Convite expirado.");
    expect(screen.queryByTestId("login-state")).toBeNull();
  });

  it("throw do invoke ⇒ mensagem genérica pt-BR sem detalhe técnico", async () => {
    invokeMock.mockRejectedValue(new Error("Network boom"));
    const { container } = renderAccept(`?token=${VALID_TOKEN}`);
    fillPasswords(container, VALID_PASSWORD, VALID_PASSWORD);
    submit(container);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Não foi possível aceitar o convite.");
    expect(alert.textContent).not.toContain("Network boom");
    expect(screen.queryByTestId("login-state")).toBeNull();
  });
});
