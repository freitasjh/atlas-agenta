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
import { cadastroMessages } from "@/auth/cadastro-messages";

/**
 * Costura de `CadastroPage` com `useSignUp` e `usePostLoginRedirect` (ADR-03).
 *
 * O contrato que a tela cumpre com a mutation é o do ADR-03:
 * - `{ session }` presente ⇒ `redirectAfterLogin(session)` (destino da ADR-08),
 *   e a tela NÃO passa por `/login`;
 * - `{ session: null }` (conta criada, login automático falhou) ⇒
 *   `navigate("/login", { state: { notice } })` neutro do catálogo, sem tratar
 *   como erro de cadastro.
 *
 * `useSignUp`, `usePostLoginRedirect` e `useCepLookup` são mockados: nenhuma
 * rede, nenhum Supabase, nenhum ViaCEP. A navegação é observada por uma
 * rota-sonda em `/login` que lê `location.state` — nada de mock de
 * `useNavigate`, para provar o estado que a `LoginPage` real consome via
 * `readNoticeState`. O `useCepLookup` fica `idle`: o cadastro manual conclui
 * sem o ViaCEP (RF06).
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

const cepState = vi.hoisted(() => ({
  status: "idle" as string,
  address: null as null,
  lookup: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/hooks/useCepLookup", () => ({
  useCepLookup: () => cepState,
}));

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

function fillById(container: HTMLElement, id: string, value: string) {
  const input = container.querySelector(`#${id}`);
  expect(input).not.toBeNull();
  fireEvent.change(input as Element, { target: { value } });
}

/** Preenche o formulário rico completo (dígitos fictícios de teste). */
async function submitForm(container: HTMLElement) {
  fillById(container, "cadastro-tradeName", "Salão da Ana");
  fillById(container, "cadastro-legalName", "Ana Souza LTDA");
  fillById(container, "cadastro-document", "529.982.247-25");
  fillById(container, "cadastro-phoneEmpresa", "(11) 98765-4321");
  fillById(container, "cadastro-addressCep", "01310-100");
  fillById(container, "cadastro-addressStreet", "Avenida Paulista");
  fillById(container, "cadastro-addressNumber", "1000");
  fillById(container, "cadastro-addressCity", "São Paulo");
  fillById(container, "cadastro-email", "dona@salao.com.br");

  const [password, confirmPassword] = Array.from(
    container.querySelectorAll("#cadastro-password, #cadastro-confirmPassword"),
  );
  fireEvent.change(password, { target: { value: "Senha@123" } });
  fireEvent.change(confirmPassword, { target: { value: "Senha@123" } });

  fillById(container, "cadastro-fullName", "Ana Souza");

  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "SP" } });
  fireEvent.change(selects[1], { target: { value: "salao" } });

  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  state.isPending = false;
  state.mutateAsync.mockReset();
  state.redirectAfterLogin.mockReset();
  cepState.status = "idle";
  cepState.lookup.mockClear();
  cepState.retry.mockClear();
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
      notice: cadastroMessages.skipAutoLoginNotice,
    });
    expect(state.redirectAfterLogin).not.toHaveBeenCalled();
  });

  it("envia os valores normalizados do formulário para a mutation", async () => {
    state.mutateAsync.mockResolvedValue({ session: null });

    const { container } = renderCadastro();
    await submitForm(container);

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(1));
    // O resolver zod normaliza antes do submit: máscaras viram só-dígitos e
    // a UF vai para maiúscula — o mesmo canônico do corpo ADR-002.
    expect(state.mutateAsync).toHaveBeenCalledWith({
      tradeName: "Salão da Ana",
      legalName: "Ana Souza LTDA",
      document: "52998224725",
      phoneEmpresa: "11987654321",
      addressCep: "01310100",
      addressStreet: "Avenida Paulista",
      addressNumber: "1000",
      addressComplement: undefined,
      addressCity: "São Paulo",
      addressState: "SP",
      email: "dona@salao.com.br",
      password: "Senha@123",
      confirmPassword: "Senha@123",
      fullName: "Ana Souza",
      segment: "salao",
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
    expect(alert.textContent).toBe(cadastroMessages.errors.emailTaken);
    expect(screen.queryByTestId("login-state")).toBeNull();
    expect(state.redirectAfterLogin).not.toHaveBeenCalled();
  });

  it("409 document_ja_cadastrado ⇒ mensagem exata do catálogo", async () => {
    state.mutateAsync.mockRejectedValue(
      Object.assign(new Error("signup_failed"), {
        status: 409,
        code: "document_ja_cadastrado",
      }),
    );

    const { container } = renderCadastro();
    await submitForm(container);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(cadastroMessages.errors.documentTaken);
    expect(screen.queryByTestId("login-state")).toBeNull();
  });
});
