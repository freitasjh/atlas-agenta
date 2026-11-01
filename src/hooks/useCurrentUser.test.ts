// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { claimsPayload, tokenWith } from "@/test/fixtures/auth-token";

/**
 * Cobertura do agregador de identidade (ADR-07/ADR-08).
 *
 * 1. Sessão viva com token sem claims ⇒ `hasIdentityError` (guards fazem logout
 *    defensivo) e `isLoadingAuth` false (não é "carregando", é falha).
 * 2. Claim `tenant_id` + leitura do tenant em erro ⇒ `hasTenantError`
 *    (assinatura ilegível não vira `subscriptionStatus === null` liberado).
 * 3. `super_admin` (`tenant_id: null`) ⇒ nenhum dos dois erros: ausência de
 *    tenant é desenho, não falha.
 *
 * `useSession` e `useTenant` são mockados — nenhuma rede, nenhum Supabase.
 * `useAuthClaims` roda de verdade sobre o token do fixture, então a claim é
 * quem comanda o cenário.
 */

const { useSessionMock, useTenantMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  useTenantMock: vi.fn(),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: useSessionMock,
  sessionQueryKey: ["session"],
}));

vi.mock("@/hooks/useTenant", () => ({
  useTenant: useTenantMock,
}));

/** Sessão mockada: só `access_token` e `user.id` importam para o agregador. */
function sessionResult(accessToken: string | null) {
  return {
    data: accessToken
      ? { access_token: accessToken, user: { id: "user-1" } }
      : null,
    isLoading: false,
  };
}

/** Resultado de query de tenant mockado (shallow: só os flags lidos). */
function tenantResult(state: { isLoading?: boolean; isError?: boolean } = {}) {
  return {
    data: undefined,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  };
}

/**
 * Renderiza `useCurrentUser` com `QueryClient` isolado por teste. O provider é
 * mantido para reproduzir o ambiente real dos guards, ainda que as duas queries
 * estejam mockadas.
 */
function renderUseCurrentUser(
  accessToken: string | null,
  tenant = tenantResult(),
) {
  useSessionMock.mockReturnValue(sessionResult(accessToken));
  useTenantMock.mockReturnValue(tenant);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  const { result } = renderHook(() => useCurrentUser(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });

  return { result, queryClient };
}

describe("useCurrentUser — identidade e falha de tenant (ADR-07/ADR-08)", () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    useTenantMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("sessão + token sem claims: hasIdentityError true e isLoadingAuth false", () => {
    // Payload sem `user_role`/`tenant_id`/`must_change_password`: token emitido
    // antes do hook `custom-access-token`.
    const { result } = renderUseCurrentUser(tokenWith({ sub: "user-1" }));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.userId).toBe("user-1");
    expect(result.current.hasIdentityError).toBe(true);
    expect(result.current.isLoadingAuth).toBe(false);
    expect(result.current.hasTenantError).toBe(false);
    expect(result.current.role).toBeNull();
    expect(result.current.tenantId).toBeNull();
  });

  it("claim com tenant_id + query do tenant em erro: hasTenantError true", () => {
    const { result } = renderUseCurrentUser(
      tokenWith(claimsPayload({ user_role: "admin" })),
      tenantResult({ isError: true }),
    );

    expect(result.current.tenantId).not.toBeNull();
    expect(result.current.hasIdentityError).toBe(false);
    expect(result.current.hasTenantError).toBe(true);
    // Assinatura ilegível não pode virar "sem assinatura" liberado.
    expect(result.current.subscriptionStatus).toBeNull();
    expect(result.current.isLoadingAuth).toBe(false);
  });

  it("super_admin (tenant_id null): nenhum erro de identidade nem de tenant", () => {
    const { result } = renderUseCurrentUser(
      tokenWith(claimsPayload({ user_role: "super_admin", tenant_id: null })),
    );

    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.tenantId).toBeNull();
    expect(result.current.hasIdentityError).toBe(false);
    expect(result.current.hasTenantError).toBe(false);
    expect(result.current.isLoadingAuth).toBe(false);
    expect(result.current.tenant).toBeNull();
  });
});
