// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTenant, tenantSchema } from "@/hooks/useTenant";
import { BUSINESS_SEGMENTS } from "@/types/domain";
import { claimsPayload, TENANT_ID, tokenWith } from "@/test/fixtures/auth-token";

/**
 * Cobertura do contrato do tenant.
 *
 * 1. `segment` no parse do tenant (ADR-03, AC-03.4/AC-03.5). Prova do
 *    `.catch(null)`: valor inesperado degrada para `null` (genérico) em vez de
 *    derrubar o parse do tenant — nunca transforma dado sujo em negação de
 *    acesso.
 * 2. Fonte do `tenantId` (ADR-07): a chave e a habilitação da query vêm da
 *    claim `tenant_id` do JWT, não de uma leitura de `profiles`.
 */

const { fromMock, useSessionMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));
vi.mock("@/hooks/useSession", () => ({
  useSession: useSessionMock,
  sessionQueryKey: ["session"],
}));

const baseRow = {
  id: TENANT_ID,
  trade_name: "Studio Lux",
  legal_name: "Studio Lux LTDA",
  subscription_status: "ativo" as const,
  timezone: "America/Sao_Paulo",
};

describe("tenantSchema.segment", () => {
  it("AC-03.4: segment conhecido é preservado", () => {
    const out = tenantSchema.parse({ ...baseRow, segment: "clinica" });
    expect(out.segment).toBe("clinica");
  });

  it("AC-03.4: valor inesperado degrada para null (prova do .catch(null))", () => {
    const out = tenantSchema.parse({ ...baseRow, segment: "xpto" });
    expect(out.segment).toBeNull();
  });

  it("AC-03.4: segment null permanece null", () => {
    const out = tenantSchema.parse({ ...baseRow, segment: null });
    expect(out.segment).toBeNull();
  });

  it("AC-03.5: BUSINESS_SEGMENTS é a tripla canônica, idêntica ao check SQL", () => {
    expect([...BUSINESS_SEGMENTS]).toEqual(["barbearia", "clinica", "salao"]);
  });
});

/**
 * Renderiza `useTenant` com a sessão mockada (só o `access_token` importa para
 * a claim) e um `QueryClient` isolado por teste. O `supabase.from` é mockado
 * para o `queryFn` não tocar a rede.
 */
function renderUseTenant(accessToken: string | null) {
  useSessionMock.mockReturnValue({
    data: accessToken ? { access_token: accessToken } : null,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  const { result } = renderHook(() => useTenant(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });

  return { result, queryClient };
}

describe("useTenant — tenantId vem da claim (ADR-07)", () => {
  beforeEach(() => {
    fromMock.mockReset();
    fromMock.mockReturnValue({
      select: () => ({
        single: async () => ({ data: { ...baseRow, segment: null }, error: null }),
      }),
    });
  });

  afterEach(() => {
    cleanup();
    useSessionMock.mockReset();
  });

  it("claim válida: queryKey carrega o tenant_id da claim e a query roda", async () => {
    const { result, queryClient } = renderUseTenant(
      tokenWith(claimsPayload({ user_role: "admin" })),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const queries = queryClient.getQueryCache().getAll();
    expect(queries).toHaveLength(1);
    expect(queries[0].queryKey).toEqual(["tenant", TENANT_ID]);
    expect(result.current.data?.trade_name).toBe("Studio Lux");
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("super_admin (tenant_id null): queryKey sem tenant e nenhum fetch", () => {
    const { result, queryClient } = renderUseTenant(
      tokenWith(claimsPayload({ user_role: "super_admin", tenant_id: null })),
    );

    const queries = queryClient.getQueryCache().getAll();
    expect(queries).toHaveLength(1);
    expect(queries[0].queryKey).toEqual(["tenant", null]);
    expect(queries[0].state.fetchStatus).toBe("idle");
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("sessão sem claims: tenantId nulo desabilita a query", () => {
    const payload = claimsPayload();
    delete payload.tenant_id;

    const { result, queryClient } = renderUseTenant(tokenWith(payload));

    const queries = queryClient.getQueryCache().getAll();
    expect(queries[0].queryKey).toEqual(["tenant", null]);
    expect(result.current.fetchStatus).toBe("idle");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("identidade inválida (tenant_id fora do UUID): queryKey não usa a claim suja", () => {
    const { result, queryClient } = renderUseTenant(
      tokenWith(claimsPayload({ tenant_id: "nao-uuid" })),
    );

    expect(
      queryClient.getQueryCache().find({ queryKey: ["tenant", "nao-uuid"] }),
    ).toBeUndefined();
    expect(result.current.fetchStatus).toBe("idle");
    expect(fromMock).not.toHaveBeenCalled();
  });
});
