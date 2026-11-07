// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, type ChangeEvent, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CadastroPage } from "@/auth/CadastroPage";
import { cadastroMessages } from "@/auth/cadastro-messages";

/**
 * FE-04 — `CadastroPage` rica (ADR-003, parecer ux vinculante SPEC §1).
 *
 * Página única, 4 fieldsets na ordem; summary com ≥2 erros + foco no 1º
 * inválido; máscaras sem travar; ViaCEP como sugestão (nunca sobrescreve
 * tocado, falha ⇒ manual + retry); toggle de senha; autocompletes.
 *
 * `useSignUp` e `useCepLookup` mockados (lógica de cada um coberta no teste
 * próprio); `Select` vira `<select>` nativo como no teste de costura.
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
  address: null as { street: string; city: string; state: string } | null,
  lookup: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/hooks/useCepLookup", () => ({
  useCepLookup: () => cepState,
}));

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("@/hooks/useAuthMutations", () => ({
  useSignUp: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));

vi.mock("@/auth/usePostLoginRedirect", () => ({
  usePostLoginRedirect: () => vi.fn(),
}));

function renderCadastro() {
  return render(
    createElement(MemoryRouter, null, createElement(CadastroPage)),
  );
}

function submitEmpty(container: HTMLElement) {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  state.mutateAsync.mockReset();
  state.mutateAsync.mockResolvedValue({ session: null });
  cepState.status = "idle";
  cepState.address = null;
  cepState.lookup.mockClear();
  cepState.retry.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("CadastroPage — 4 fieldsets na ordem (parecer ux)", () => {
  it("renderiza Empresa → Endereço → Acesso → Responsável com fieldset/legend", () => {
    const { container } = renderCadastro();
    const fieldsets = Array.from(container.querySelectorAll("fieldset"));
    expect(fieldsets).toHaveLength(4);
    const legends = fieldsets.map(
      (fs) => fs.querySelector("legend")?.textContent,
    );
    expect(legends).toEqual([
      cadastroMessages.sections.empresa.legend,
      cadastroMessages.sections.endereco.legend,
      cadastroMessages.sections.acesso.legend,
      cadastroMessages.sections.responsavel.legend,
    ]);
  });

  it("segment mora no bloco 4 (Responsável), não no bloco 1", () => {
    const { container } = renderCadastro();
    const fieldsets = Array.from(container.querySelectorAll("fieldset"));
    expect(fieldsets[0].textContent).not.toContain(
      cadastroMessages.labels.segment,
    );
    expect(fieldsets[3].textContent).toContain(cadastroMessages.labels.segment);
  });

  it("pares usam grid 2 col no sm; submit único", () => {
    const { container } = renderCadastro();
    const grids = container.querySelectorAll(".sm\\:grid-cols-2");
    expect(grids.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(
      1,
    );
  });
});

describe("CadastroPage — error-summary + foco", () => {
  it("≥2 erros ⇒ summary com âncoras e foco no 1º inválido", async () => {
    const { container } = renderCadastro();
    submitEmpty(container);

    const summary = await screen.findByRole("alert");
    expect(summary.textContent).toContain(cadastroMessages.summary.title);

    await waitFor(() =>
      expect(document.activeElement?.id).toBe("cadastro-tradeName"),
    );
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it("âncora do summary leva o foco ao campo", async () => {
    const { container } = renderCadastro();
    submitEmpty(container);

    await screen.findByRole("alert");
    const cityLink = screen.getByRole("button", {
      name: new RegExp(cadastroMessages.labels.addressCity),
    });
    fireEvent.click(cityLink);

    await waitFor(() =>
      expect(document.activeElement?.id).toBe("cadastro-addressCity"),
    );
  });
});

describe("CadastroPage — máscaras sem travar", () => {
  it("digitação parcial é reformatada sem bloquear", () => {
    const { container } = renderCadastro();
    const document = container.querySelector(
      "#cadastro-document",
    ) as HTMLInputElement;
    fireEvent.change(document, { target: { value: "5299" } });
    expect(document.value).toBe("529.9");
    fireEvent.change(document, { target: { value: "529.9" } });
    expect(document.value).toBe("529.9");
  });

  it("colar formatado é aceito idempotente", () => {
    const { container } = renderCadastro();
    const phone = container.querySelector(
      "#cadastro-phoneEmpresa",
    ) as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "(11) 98765-4321" } });
    expect(phone.value).toBe("(11) 98765-4321");
  });

  it("nunca usa type=number", () => {
    const { container } = renderCadastro();
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });
});

describe("CadastroPage — ViaCEP sugestão (nunca autoridade)", () => {
  it("sucesso preenche editável o que o usuário não tocou", async () => {
    cepState.status = "idle";
    const { rerender } = renderCadastro();

    cepState.status = "success";
    cepState.address = {
      street: "Avenida Paulista",
      city: "São Paulo",
      state: "SP",
    };
    rerender(createElement(MemoryRouter, null, createElement(CadastroPage)));

    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            cadastroMessages.labels.addressCity,
          ) as HTMLInputElement
        ).value,
      ).toBe("São Paulo"),
    );
    const street = screen.getByLabelText(
      cadastroMessages.labels.addressStreet,
    ) as HTMLInputElement;
    expect(street.value).toBe("Avenida Paulista");
    // Editável: o usuário pode mudar depois do pré-preenchimento.
    fireEvent.change(street, { target: { value: "Rua nova" } });
    expect(street.value).toBe("Rua nova");
  });

  it("nunca sobrescreve campo que o usuário já editou", async () => {
    cepState.status = "idle";
    const { rerender } = renderCadastro();

    const street = screen.getByLabelText(
      cadastroMessages.labels.addressStreet,
    ) as HTMLInputElement;
    fireEvent.change(street, { target: { value: "Rua digitada" } });

    cepState.status = "success";
    cepState.address = {
      street: "Avenida Paulista",
      city: "São Paulo",
      state: "SP",
    };
    rerender(createElement(MemoryRouter, null, createElement(CadastroPage)));

    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            cadastroMessages.labels.addressCity,
          ) as HTMLInputElement
        ).value,
      ).toBe("São Paulo"),
    );
    // Tocado antes do retorno: preservado.
    expect(
      (
        screen.getByLabelText(
          cadastroMessages.labels.addressStreet,
        ) as HTMLInputElement
      ).value,
    ).toBe("Rua digitada");
  });

  it("loading anuncia com aria-live e trava só o bloco", () => {
    cepState.status = "loading";
    const { container } = renderCadastro();
    expect(
      screen.getByText(cadastroMessages.viaCep.searching),
    ).toBeDefined();
    const addressFieldset = Array.from(
      container.querySelectorAll("fieldset"),
    )[1];
    expect(addressFieldset.getAttribute("aria-busy")).toBe("true");
  });

  it("falha mostra retry que repete o lookup", () => {
    cepState.status = "error";
    renderCadastro();
    expect(screen.getByText(cadastroMessages.viaCep.error)).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: cadastroMessages.viaCep.retry }),
    );
    expect(cepState.retry).toHaveBeenCalledTimes(1);
  });

  it("CEP não encontrado pede preenchimento manual", () => {
    cepState.status = "not-found";
    renderCadastro();
    expect(screen.getByText(cadastroMessages.viaCep.notFound)).toBeDefined();
  });
});

describe("CadastroPage — a11y e autocompletes", () => {
  it("inputs carregam os autocompletes do parecer", () => {
    const { container } = renderCadastro();
    const cases: Array<[string, string]> = [
      ["#cadastro-tradeName", "organization"],
      ["#cadastro-addressCep", "postal-code"],
      ["#cadastro-addressStreet", "street-address"],
      ["#cadastro-addressCity", "address-level2"],
      ["#cadastro-email", "email"],
      ["#cadastro-password", "new-password"],
      ["#cadastro-fullName", "given-name"],
      ["#cadastro-phoneEmpresa", "tel"],
    ];
    for (const [selector, autocomplete] of cases) {
      expect(
        container.querySelector(selector)?.getAttribute("autocomplete"),
      ).toBe(autocomplete);
    }
  });

  it("toggle de senha alterna tipo com aria-pressed", () => {
    const { container } = renderCadastro();
    const password = container.querySelector(
      "#cadastro-password",
    ) as HTMLInputElement;
    const toggle = screen.getAllByRole("button", {
      name: cadastroMessages.showPassword,
    })[0];
    expect(password.type).toBe("password");
    fireEvent.click(toggle);
    expect(password.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("helper LGPD no bloco 1", () => {
    renderCadastro();
    expect(screen.getByText(cadastroMessages.lgpdHelper)).toBeDefined();
  });
});

describe("CadastroPage — navegação por steps (Wizard)", () => {
  it("renderiza o stepper com 4 etapas e inicia na Etapa 1", () => {
    const { container } = renderCadastro();
    const nav = screen.getByRole("navigation", { name: "Etapas do cadastro" });
    expect(nav).toBeDefined();

    // Etapa 1 está visível (não tem classe hidden)
    const fieldsets = container.querySelectorAll("fieldset");
    expect(fieldsets[0].className).toContain("block");
    expect(fieldsets[1].className).toContain("hidden");
    expect(fieldsets[2].className).toContain("hidden");
    expect(fieldsets[3].className).toContain("hidden");

    // Botão Voltar não aparece na Etapa 1
    expect(screen.queryByRole("button", { name: /Voltar/i })).toBeNull();
    // Botão Avançar está presente
    expect(screen.getByRole("button", { name: /Avançar/i })).toBeDefined();
  });

  it("não avança para o Passo 2 com campos vazios inválidos no Passo 1", async () => {
    const { container } = renderCadastro();
    const btnAvancar = screen.getByRole("button", { name: /Avançar/i });
    fireEvent.click(btnAvancar);

    // Permanece na Etapa 1
    const fieldsets = container.querySelectorAll("fieldset");
    expect(fieldsets[0].className).toContain("block");
    expect(fieldsets[1].className).toContain("hidden");
  });

  it("avança para Passo 2 com dados válidos e botão Voltar retorna preservando dados", async () => {
    const { container } = renderCadastro();

    const tradeName = container.querySelector(
      "#cadastro-tradeName",
    ) as HTMLInputElement;
    const document = container.querySelector(
      "#cadastro-document",
    ) as HTMLInputElement;
    const phone = container.querySelector(
      "#cadastro-phoneEmpresa",
    ) as HTMLInputElement;

    fireEvent.change(tradeName, { target: { value: "Studio Belle" } });
    fireEvent.change(document, { target: { value: "529.982.247-25" } });
    fireEvent.change(phone, { target: { value: "(11) 98765-4321" } });

    const btnAvancar = screen.getByRole("button", { name: /Avançar/i });
    fireEvent.click(btnAvancar);

    await waitFor(() => {
      const fieldsets = container.querySelectorAll("fieldset");
      expect(fieldsets[0].className).toContain("hidden");
      expect(fieldsets[1].className).toContain("block");
    });

    // Clica em Voltar
    const btnVoltar = screen.getByRole("button", { name: /Voltar/i });
    fireEvent.click(btnVoltar);

    // Retornou para o Passo 1 com os dados intactos
    const fieldsets = container.querySelectorAll("fieldset");
    expect(fieldsets[0].className).toContain("block");
    expect(tradeName.value).toBe("Studio Belle");
  });
});

