// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthCard } from "@/components/shadcn/auth/auth-card";
import { AuthShell } from "@/components/shadcn/auth/auth-shell";
import { LoginForm, type LoginFormProps } from "@/components/shadcn/auth/login-form";
import { SignupForm } from "@/components/shadcn/auth/signup-form";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";

afterEach(cleanup);

// happy-dom deste repo não expõe localStorage; ThemeProvider (default do
// AuthShell) precisa dele para ler/escrever o tema nos testes.
beforeEach(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
  }
});

function renderInRouter(ui: React.ReactNode) {
  return render(createElement(MemoryRouter, null, ui));
}

function LoginHarness({
  onSubmit = vi.fn(),
  ...props
}: Partial<Omit<LoginFormProps, "form" | "onSubmit">> & {
  onSubmit?: (values: LoginInput) => void | Promise<void>;
}) {
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  return createElement(LoginForm, { form, onSubmit, ...props });
}

describe("AuthCard", () => {
  it("renderiza rim light decorativo e conteúdo", () => {
    const { container } = render(createElement(AuthCard, null, "conteúdo"));

    expect(container.textContent).toContain("conteúdo");
    const rim = container.querySelector("span[aria-hidden='true']");
    expect(rim).not.toBeNull();
    expect(rim?.className).toContain("bg-gradient-to-r");
    expect(container.firstElementChild?.className).toContain("rounded-2xl");
  });
});

describe("AuthShell", () => {
  function renderShell(internal: boolean) {
    return render(
      createElement(
        ThemeProvider,
        null,
        createElement(
          MemoryRouter,
          null,
          createElement(
            Routes,
            null,
            createElement(
              Route,
              {
                path: "/",
                element: createElement(AuthShell, { internal }),
              },
              createElement(Route, {
                index: true,
                element: createElement("p", null, "CONTEUDO_DA_ROTA"),
              }),
            ),
          ),
        ),
      ),
    );
  }

  it("variante internal: só logo + Outlet, sem link público, toggle e capa", () => {
    const { container } = renderShell(true);

    expect(screen.getByText("CONTEUDO_DA_ROTA")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /atlas agenda/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /tema/i })).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
    expect(container.firstElementChild?.className).not.toContain("lg:grid-cols-2");
    expect(screen.getByText("CONTEUDO_DA_ROTA").parentElement?.className).toContain(
      "max-w-md",
    );
  });

  it("variante default preserva link público, toggle de tema e capa", () => {
    const { container } = renderShell(false);

    expect(
      screen.getByRole("link", { name: /atlas agenda/i }).getAttribute("href"),
    ).toBe("/");
    expect(screen.getByRole("button", { name: /tema/i })).toBeTruthy();
    expect(container.querySelector("aside")).not.toBeNull();
  });
});

describe("LoginForm", () => {
  it("usa links do React Router (sem href '#' )", () => {
    renderInRouter(createElement(LoginHarness));

    const forgot = screen.getByRole("link", { name: /esqueceu a senha/i });
    const signup = screen.getByRole("link", { name: /criar conta/i });
    expect(forgot.getAttribute("href")).toBe("/recuperar-senha");
    expect(signup.getAttribute("href")).toBe("/cadastro");
  });

  it("notice vira role=status, erro vira role=alert e recebe foco via errorRef", () => {
    const error = "E-mail ou senha inválidos.";
    function Harness() {
      const ref = useRef<HTMLParagraphElement>(null);
      // Espelha LoginPage/CadastroPage: quem chama focaliza o alerta quando o
      // erro aparece; o componente só expõe o ref no `role="alert"`.
      useEffect(() => {
        ref.current?.focus();
      }, [error]);
      return createElement(LoginHarness, {
        notice: "Conta criada. Entre com seu e-mail e senha.",
        error,
        errorRef: ref,
      });
    }
    renderInRouter(createElement(Harness));

    expect(screen.getByRole("status").textContent).toBe(
      "Conta criada. Entre com seu e-mail e senha.",
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(error);
    expect(document.activeElement).toBe(alert);
  });

  it("submete valores validados e desabilita em pending", async () => {
    const onSubmit = vi.fn();
    renderInRouter(createElement(LoginHarness, { onSubmit }));

    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "dona@salao.com.br" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "Senha@123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // handleSubmit repassa o evento como 2º argumento; o contrato da página é
    // o 1º (valores já validados pelo zod resolver).
    expect(onSubmit.mock.calls[0][0]).toEqual({
      email: "dona@salao.com.br",
      password: "Senha@123",
    });

    cleanup();
    const { container } = renderInRouter(
      createElement(LoginHarness, { isPending: true }),
    );
    expect((container.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/entrando/i)).not.toBeNull();
  });

  it("exibe erro de campo com role=alert e aria-invalid", async () => {
    renderInRouter(createElement(LoginHarness));

    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "invalido" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(screen.getByLabelText("E-mail").getAttribute("aria-invalid")).toBe("true"),
    );
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("variante interna: título/descrição configuráveis, sem links de cadastro e CTA ≥44px", () => {
    renderInRouter(
      createElement(LoginHarness, {
        title: "Área interna",
        description: "Entrada exclusiva de operadores.",
        showForgotPassword: false,
        showSignupLink: false,
        submitClassName: "min-h-[44px]",
      }),
    );

    expect(screen.getByRole("heading", { name: "Área interna" }).textContent).toBe(
      "Área interna",
    );
    expect(screen.getByText("Entrada exclusiva de operadores.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /esqueceu a senha/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /criar conta/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Entrar" }).className).toContain(
      "min-h-[44px]",
    );
  });

  it("erro expõe aria-live=assertive para leitores de tela", () => {
    renderInRouter(createElement(LoginHarness, { error: "E-mail ou senha inválidos." }));

    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");
  });

  it("mantém a live region role=alert sempre montada, vazia quando sem erro", () => {
    const { rerender } = renderInRouter(createElement(LoginHarness));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("aria-atomic")).toBe("true");

    // A mesma região atualiza só o texto — sem remontar o container.
    rerender(
      createElement(MemoryRouter, null, createElement(LoginHarness, { error: "E-mail ou senha inválidos." })),
    );
    expect(screen.getByRole("alert").textContent).toBe("E-mail ou senha inválidos.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("SignupForm", () => {
  it("renderiza cabeçalho, children, feedback e rodapé controlados por props", () => {
    const { container } = render(
      createElement(
        SignupForm,
        {
          title: "Criar sua conta",
          description: "Preencha os dados abaixo.",
          notice: "Aviso neutro",
          error: "Falha no cadastro",
          footer: "Já tem conta?",
          onSubmit: (event: React.FormEvent<HTMLFormElement>) => event.preventDefault(),
        },
        createElement("input", { "aria-label": "Campo real", name: "real" }),
      ),
    );

    expect(screen.getByText("Criar sua conta")).not.toBeNull();
    expect(screen.getByText("Preencha os dados abaixo.")).not.toBeNull();
    expect(screen.getByLabelText("Campo real")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Aviso neutro");
    expect(screen.getByRole("alert").textContent).toBe("Falha no cadastro");
    expect(screen.getByText("Já tem conta?")).not.toBeNull();
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("sem notice/erro não renderiza alertas e respeita aria-busy/disabled", () => {
    const { container } = render(
      createElement(
        SignupForm,
        {
          isPending: true,
          disabled: true,
          onSubmit: (event: React.FormEvent<HTMLFormElement>) => event.preventDefault(),
        },
        createElement("input", { "aria-label": "Campo real", name: "real" }),
      ),
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(
      container.querySelector("[aria-disabled='true']")?.contains(
        container.querySelector("input"),
      ),
    ).toBe(true);
  });
});
