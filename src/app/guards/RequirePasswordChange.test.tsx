// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequirePasswordChange } from "@/app/guards/RequirePasswordChange";
import type { CurrentUser } from "@/hooks/useCurrentUser";

/**
 * Contrato de tradução do guard de troca obrigatória (ADR-11). A regra mora em
 * `decidePasswordGate` (coberta em `src/auth/passwordGate.test.ts`); aqui
 * provamos que o componente conecta os dois estados de maior risco:
 *
 * 1. flag ligada ⇒ `Navigate` para `/trocar-senha`, sem renderizar o conteúdo
 *    da rota privada;
 * 2. identidade ilegível ⇒ `DefensiveLogout` (fallback + `signOut`), nunca a
 *    rota privada nem `/login` por conta própria.
 *
 * `useCurrentUser` e `useAuthMutations` são mockados: nenhuma rede, nenhum
 * Supabase. O `useSignOut` devolve `isSuccess`/`isError` falsos para manter o
 * `DefensiveLogout` no fallback durante a asserção.
 */

const state = vi.hoisted(() => ({
  user: null as unknown as CurrentUser,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => state.user,
}));

vi.mock("@/hooks/useAuthMutations", () => ({
  useSignOut: () => ({
    mutate: state.mutate,
    isSuccess: false,
    isError: false,
  }),
}));

/** Identidade liberada por padrão; cada caso liga só o sinal que importa. */
function currentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    isLoadingAuth: false,
    session: null,
    userId: "user-1",
    role: "admin",
    tenantId: "tenant-1",
    mustChangePassword: false,
    tenant: null,
    subscriptionStatus: null,
    isAuthenticated: true,
    isSuperAdmin: false,
    hasIdentityError: false,
    hasTenantError: false,
    ...overrides,
  };
}

function renderGuard(user: CurrentUser, initialEntry = "/app/agenda") {
  state.user = user;

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<RequirePasswordChange />}>
          <Route path="/app/agenda" element={<p>conteúdo da agenda</p>} />
        </Route>
        <Route path="/trocar-senha" element={<p>tela de troca de senha</p>} />
        <Route path="/login" element={<p>tela de login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.mutate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RequirePasswordChange", () => {
  it("flag ligada ⇒ redireciona para /trocar-senha sem renderizar a rota privada", () => {
    renderGuard(currentUser({ mustChangePassword: true }));

    expect(screen.getByText("tela de troca de senha")).toBeTruthy();
    expect(screen.queryByText("conteúdo da agenda")).toBeNull();
  });

  it("identidade ilegível ⇒ renderiza DefensiveLogout (fallback + signOut)", () => {
    const { container } = renderGuard(currentUser({ hasIdentityError: true }));

    // O fallback do `DefensiveLogout` é `aria-hidden` e sem texto; o `signOut`
    // despachado no mount é a evidência direta de que o componente montou.
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByText("conteúdo da agenda")).toBeNull();
    expect(screen.queryByText("tela de login")).toBeNull();
  });
});
