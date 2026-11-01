// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, type ChangeEvent, type ReactNode } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CadastroPage } from "@/auth/CadastroPage";

/**
 * Costura de `CadastroPage` com `useSignUp` e `usePostLoginRedirect` (ADR-03).
 *
 * O contrato que a tela cumpre com a mutation é o do ADR-03:
 * - `{ session }` presente ⇒ `redirectAfterLogin(session)` (destino da ADR-08),
 *   e a tela NÃO passa por `/login`;
 * - `{ session: null }` (conta criada, login automático falhou) ⇒
 *   `navigate("/login", { state: { notice: "Conta criada. Entre com seu e-mail
 *   e senha." } })`, sem tratar como erro de cadastro.
 *
 * `useSignUp` e `usePostLoginRedirect` são mockados: nenhuma rede, nenhum
 * Supabase. A navegação é observada por uma rota-sonda em `/login` que lê
 * `location.state` — nada de mock de `useNavigate`, para provar o estado que a
 * `LoginPage` real consome via `readNoticeState`.
 */

/**
 * `Select` do design system vira um `<select>` nativo neste teste: o Radix
 * monta as opções num portal com posicionamento medido, que o happy-dom não
 * resolve. A troca é só do primitivo de entrada — a lógica sob teste é a
 * costura do `CadastroPage` com `useSignUp`/`usePostLoginRedirect`.
 */
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");

  type SelectProps = {
    children?: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  };

  return {
    Select: ({ children, value, onValueChange }: SelectProps) =>
      React.createElement(
        "select",
        {
          value: value ?? "",
          onChange: (event: ChangeEvent<HTMLSelectElement>) =>
            onValueChange?.(event.target.value),
        },
        children,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: SelectProps) =>
      React.createElement(React.Fragment, null, children),
    SelectItem: ({ children, value }: SelectProps) =>
      React.createElement("option", { value }, children),
  };
});

const state = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
  redirectAfterLogin: vi.fn(),
}));

vi.mock("@/hooks/useAuthMutations", () => ({
  useSignUp: () => ({
    mutateAsync: state.mutateAsync,
    isPending: state.isPending,
  }),
}));

vi.mock("@/auth/usePostLoginRedirect", () => ({
  usePostLoginRedirect: () => state.redirectAfterLogin,
}));

const SKIP_AUTO_LOGIN_NOTICE = "Conta criada. Entre com seu e-mail e senha.";

const SESSION = {
  access_token: "token-de-teste",
  refresh_token: "refresh-de-teste",
  user: { id: "user-1" },
};

/** Rota-sonda: expõe o `location.state` recebido em `/login`. */
function LoginProbe() {
  const location = useLocation();

  return createElement(
    "p",
    { "data-testid": "login-state" },
    JSON.stringify(location.state),
  );
}

function renderCadastro() {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/cadastro"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/cadastro",
          element: createElement(CadastroPage),
        }),
        createElement(Route, {
          path: "/login",
          element: createElement(LoginProbe),
        }),
      ),
    ),
  );
}

/** Escolhe o ramo no `Select` (mockado como `<select>` nativo). */
function selectSegment(label: string) {
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: label },
  });
}

async function submitForm(container: HTMLElement, segment = "clinica") {
  fireEvent.change(
    container.querySelector("input[autocomplete='organization']") as Element,
    { target: { value: "Clínica Bem Viver" } },
  );
  fireEvent.change(container.querySelector("input[type='email']") as Element, {
    target: { value: "ana@clinica.test" },
  });

  const [password, confirmPassword] = Array.from(
    container.querySelectorAll("input[type='password']"),
  );
  fireEvent.change(password, { target: { value: "senha-segura-1" } });
  fireEvent.change(confirmPassword, { target: { value: "senha-segura-1" } });

  selectSegment(segment);

  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  state.isPending = false;
  state.mutateAsync.mockReset();
  state.redirectAfterLogin.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("CadastroPage — costura com useSignUp (ADR-03)", () => {
  it("sessão presente ⇒ redirectAfterLogin chamado e nenhum desvio para /login", async () => {
    state.mutateAsync.mockResolvedValue({ session: SESSION });

    const { container } = renderCadastro();
    await submitForm(container);

    await waitFor(() =>
      expect(state.redirectAfterLogin).toHaveBeenCalledTimes(1),
    );
    expect(state.redirectAfterLogin).toHaveBeenCalledWith(SESSION);
    expect(screen.queryByTestId("login-state")).toBeNull();
  });

  it("sessão null ⇒ /login com state.notice neutro e sem redirect de login", async () => {
    state.mutateAsync.mockResolvedValue({ session: null });

    const { container } = renderCadastro();
    await submitForm(container);

    const probe = await screen.findByTestId("login-state");

    expect(JSON.parse(probe.textContent ?? "null")).toEqual({
      notice: SKIP_AUTO_LOGIN_NOTICE,
    });
    expect(state.redirectAfterLogin).not.toHaveBeenCalled();
  });

  it("envia só os valores do formulário para a mutation", async () => {
    state.mutateAsync.mockResolvedValue({ session: null });

    const { container } = renderCadastro();
    await submitForm(container);

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(1));
    expect(state.mutateAsync).toHaveBeenCalledWith({
      tradeName: "Clínica Bem Viver",
      segment: "clinica",
      email: "ana@clinica.test",
      password: "senha-segura-1",
      confirmPassword: "senha-segura-1",
    });
  });

  it("erro do cadastro ⇒ alerta pt-BR na tela, sem navegação", async () => {
    state.mutateAsync.mockRejectedValue(
      Object.assign(new Error("signup_failed"), {
        status: 409,
        code: "email_ja_cadastrado",
      }),
    );

    const { container } = renderCadastro();
    await submitForm(container);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Este e-mail já tem cadastro.");
    expect(screen.queryByTestId("login-state")).toBeNull();
    expect(state.redirectAfterLogin).not.toHaveBeenCalled();
  });
});
