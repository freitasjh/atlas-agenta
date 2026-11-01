// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrocarSenhaPage } from "@/auth/TrocarSenhaPage";

/**
 * Guard de duplo submit e estado do botão da tela de troca de senha (ADR-10).
 *
 * O `disabled` do botão só existe depois da re-renderização, então dois
 * `submit` síncronos (Enter repetido/clique duplo na mesma janela) chegariam ao
 * `onSubmit` com `isPending` ainda falso. Quem fecha essa janela é o `useRef`
 * síncrono — este teste monta o componente de verdade (happy-dom) para provar
 * que a segunda chamada não gera segunda requisição.
 *
 * `useCurrentUser` e `useAuthMutations` são mockados: nenhuma rede, nenhum
 * Supabase. A `mutateAsync` fica pendente de propósito — é o estado real durante
 * o clique duplo.
 */

const state = vi.hoisted(() => ({
  isLoadingAuth: false,
  isPending: false,
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    isLoadingAuth: state.isLoadingAuth,
    session: { user: { id: "user-1", email: "ana@clinica.test" } },
    userId: "user-1",
    role: "admin",
    tenantId: "tenant-1",
    mustChangePassword: true,
    tenant: null,
    subscriptionStatus: null,
    isAuthenticated: true,
    isSuperAdmin: false,
    hasIdentityError: false,
    hasTenantError: false,
  }),
}));

vi.mock("@/hooks/useAuthMutations", () => ({
  useChangeInitialPassword: () => ({
    mutateAsync: state.mutateAsync,
    reset: state.reset,
    isPending: state.isPending,
  }),
  useSignOut: () => ({ mutateAsync: state.signOut, isPending: false }),
}));

const PASSWORD = "senha-nova-1";

function renderPage() {
  return render(
    createElement(MemoryRouter, null, createElement(TrocarSenhaPage)),
  );
}

/** Preenche os dois campos de senha com valores válidos. */
function fillPasswords(container: HTMLElement) {
  const [password, confirmPassword] = Array.from(
    container.querySelectorAll("input[type='password']"),
  ) as HTMLInputElement[];

  fireEvent.change(password, { target: { value: PASSWORD } });
  fireEvent.change(confirmPassword, { target: { value: PASSWORD } });
}

beforeEach(() => {
  state.isLoadingAuth = false;
  state.isPending = false;
  state.mutateAsync.mockReset();
  state.reset.mockReset();
  state.signOut.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TrocarSenhaPage — guard de duplo submit", () => {
  it("dois submits síncronos chamam mutateAsync uma única vez", async () => {
    // Nunca resolve: a tela fica no estado pendente durante a asserção.
    state.mutateAsync.mockReturnValue(new Promise(() => {}));

    const { container } = renderPage();
    fillPasswords(container);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
      fireEvent.submit(form as HTMLFormElement);
    });

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(1));

    // Dá chance ao segundo submit (resolução do resolver zod) de escapar.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.mutateAsync).toHaveBeenCalledTimes(1);
    expect(state.mutateAsync).toHaveBeenCalledWith({ password: PASSWORD });
  });

  it("botão fica desabilitado enquanto a identidade carrega", () => {
    state.isLoadingAuth = true;

    renderPage();

    const submit = screen.getByRole("button", {
      name: "Salvar nova senha",
    }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
  });

  it("botão fica desabilitado enquanto a mutation está pendente", () => {
    state.isPending = true;

    renderPage();

    const submit = screen.getByRole("button", {
      name: "Salvando…",
    }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
  });
});
