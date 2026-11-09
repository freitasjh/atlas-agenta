import { describe, expect, it } from "vitest";

import {
  decidePasswordGate,
  type PasswordGateInput,
} from "@/auth/passwordGate";
import { POST_LOGIN_CHANGE_PASSWORD } from "@/auth/resolvePostLoginDestination";

/**
 * Contrato de `decidePasswordGate` (ADR-11). Função pura que os guards de
 * `/app` e `/internal-admin` traduzem em `RouteFallback`, `Navigate`, `DefensiveLogout`
 * ou `Outlet`. A ordem das regras é parte do contrato: carregando antes de
 * anônimo, erro de identidade antes da flag, e `/trocar-senha` nunca recebe
 * `change-password` (evita laço).
 */

function decide(overrides: Partial<PasswordGateInput> = {}) {
  return decidePasswordGate({
    isLoadingAuth: false,
    isAuthenticated: true,
    hasIdentityError: false,
    mustChangePassword: false,
    pathname: "/app/agenda",
    ...overrides,
  });
}

describe("decidePasswordGate", () => {
  it("carregando identidade ⇒ loading (mesmo sem sessão)", () => {
    expect(decide({ isLoadingAuth: true, isAuthenticated: false })).toBe(
      "loading",
    );
  });

  it("carregando vence a flag de troca ⇒ loading", () => {
    expect(decide({ isLoadingAuth: true, mustChangePassword: true })).toBe(
      "loading",
    );
  });

  it("sem sessão ⇒ anonymous", () => {
    expect(decide({ isAuthenticated: false })).toBe("anonymous");
  });

  it("sem sessão com flag ligada ⇒ anonymous (flag não vaza para anônimo)", () => {
    expect(
      decide({ isAuthenticated: false, mustChangePassword: true }),
    ).toBe("anonymous");
  });

  it("sessão com claims ilegíveis ⇒ identity-error", () => {
    expect(decide({ hasIdentityError: true })).toBe("identity-error");
  });

  it("erro de identidade vence a flag ⇒ identity-error", () => {
    expect(decide({ hasIdentityError: true, mustChangePassword: true })).toBe(
      "identity-error",
    );
  });

  it("flag ligada em /app ⇒ change-password", () => {
    expect(decide({ mustChangePassword: true })).toBe("change-password");
  });

  it("flag ligada em /internal-admin ⇒ change-password", () => {
    expect(
      decide({ mustChangePassword: true, pathname: "/internal-admin/empresas" }),
    ).toBe("change-password");
  });

  it("flag ligada na própria tela de troca ⇒ allow (sem laço)", () => {
    expect(
      decide({
        mustChangePassword: true,
        pathname: POST_LOGIN_CHANGE_PASSWORD,
      }),
    ).toBe("allow");
  });

  it("sessão válida com flag limpa ⇒ allow", () => {
    expect(decide({ pathname: "/internal-admin/empresas" })).toBe("allow");
  });

  it("flag limpa na tela de troca ⇒ allow", () => {
    expect(decide({ pathname: POST_LOGIN_CHANGE_PASSWORD })).toBe("allow");
  });
});
