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
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthCard } from "@/components/shadcn/auth/auth-card";
import { LoginForm, type LoginFormProps } from "@/components/shadcn/auth/login-form";
import { SignupForm } from "@/components/shadcn/auth/signup-form";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";

afterEach(cleanup);

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
