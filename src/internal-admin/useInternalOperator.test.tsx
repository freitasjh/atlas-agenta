// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInternalOperator } from "@/internal-admin/useInternalOperator";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}));

import { supabase } from "@/lib/supabase";

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;
const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

function renderOperatorHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useInternalOperator(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({
    data: { session: { access_token: "tok", user: { id: "u-1" } } },
    error: null,
  });
});

afterEach(() => cleanup());

describe("useInternalOperator — mapeamento snake_case da Edge (C4)", () => {
  it("snake_case {is_operator:true, aal:aal2, user_id} libera área interna", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: true, aal: "aal2", user_id: "x" },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("allowed"));
    expect(result.current).toEqual({ status: "allowed", userId: "x" });
  });

  it("camelCase legado continua liberando (compat)", async () => {
    invoke.mockResolvedValue({
      data: { isOperator: true, aal: "aal2", userId: "y" },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("allowed"));
    expect(result.current).toEqual({ status: "allowed", userId: "y" });
  });

  it("operador sem aal2 cai em mfa_required (snake_case)", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: true, aal: "aal1", user_id: "x" },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("mfa_required"));
  });

  it("não-operador snake_case vira forbidden sem dado", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: false },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("forbidden"));
  });

  it("401 da Edge vira unauthenticated", async () => {
    invoke.mockResolvedValue({ data: null, error: { status: 401 } });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
  });

  it("sem sessão vira unauthenticated sem chamar Edge", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("useInternalOperator — roteamento enroll × mfa (enrolled_factors)", () => {
  it("operador aal1 sem factors vai para enroll_required", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: true, aal: "aal1", user_id: "x", enrolled_factors: 0 },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("enroll_required"));
  });

  it("operador aal1 com factors vai para mfa_required (inalterado)", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: true, aal: "aal1", user_id: "x", enrolled_factors: 2 },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("mfa_required"));
  });

  it("resposta legada sem enrolled_factors mantém mfa_required", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: true, aal: "aal1", user_id: "x" },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("mfa_required"));
  });

  it("resposta legada aal2 sem enrolled_factors mantém allowed", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: true, aal: "aal2", user_id: "x" },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("allowed"));
  });

  it("aal2 com enrolled_factors 0 vira forbidden (fail-closed)", async () => {
    invoke.mockResolvedValue({
      data: { is_operator: true, aal: "aal2", user_id: "x", enrolled_factors: 0 },
      error: null,
    });
    const { result } = renderOperatorHook();
    await waitFor(() => expect(result.current.status).toBe("forbidden"));
  });
});
