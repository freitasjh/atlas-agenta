// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "@/auth/LoginPage";

/**
 * Aviso de "conta criada" na tela de login (ADR-03).
 *
 * Quando a Edge Function cria a empresa mas o login automático falha, o
 * cadastro navega para `/login` com `state.notice`. A tela mostra esse texto
 * como `role="status"` (feedback neutro, não erro). Sem `notice`, nada é
 * renderizado — o `state` nunca vira markup.
 */

const SIGNUP_CREATED_NOTICE = "Conta criada. Entre com seu e-mail e senha.";

vi.mock("@/hooks/useAuthMutations", () => ({
  useSignIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderLogin(state?: Record<string, unknown>) {
  const entry = state === undefined ? "/login" : { pathname: "/login", state };

  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(LoginPage),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe("LoginPage — aviso de conta criada (ADR-03)", () => {
  it("mostra o aviso entregue por location.state", () => {
    renderLogin({ notice: SIGNUP_CREATED_NOTICE });

    expect(screen.getByRole("status").textContent).toBe(SIGNUP_CREATED_NOTICE);
  });

  it("sem notice ⇒ nenhum aviso renderizado", () => {
    renderLogin();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("notice não-string ⇒ nada é renderizado", () => {
    renderLogin({ notice: { texto: SIGNUP_CREATED_NOTICE } });

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(SIGNUP_CREATED_NOTICE)).toBeNull();
  });
});
