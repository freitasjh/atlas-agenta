// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useChangeInitialPassword,
  type ChangeInitialPasswordResult,
} from "@/hooks/useAuthMutations";
import { mapInitialPasswordError } from "@/lib/auth-errors";
import {
  claimsPayload,
  TENANT_ID,
  tokenWith,
} from "@/test/fixtures/auth-token";

/**
 * Contrato de `useChangeInitialPassword` (ADR-09).
 *
 * 1. O corpo do `functions.invoke` leva SÓ `password` — o usuário vem do JWT.
 * 2. Sucesso renova o token e devolve as claims do token NOVO.
 * 3. 409 só é sucesso com o código estável `password_change_not_required`
 *    (fail-closed): 409 sem código legível é erro.
 * 4. `refreshSession` falho não derruba a mutation, mas devolve `claims: null`
 *    (a senha já foi salva; a tela da ADR-10 decide pedir login de novo).
 *
 * Supabase inteiro é mockado: nenhuma rede.
 */

const { invokeMock, refreshSessionMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  refreshSessionMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { refreshSession: refreshSessionMock },
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/hooks/useSession", () => ({ sessionQueryKey: ["session"] }));

const PASSWORD = "senha-nova-1";

/** Erro no shape do `FunctionsHttpError`: `context` é a `Response`. */
function functionsHttpError(status: number, body: string | null) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(body, { status }),
  };
}

function renderChangeInitialPassword() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  const { result } = renderHook(() => useChangeInitialPassword(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });

  return { result, queryClient };
}

async function runMutation(
  mutation: ReturnType<typeof useChangeInitialPassword>,
): Promise<ChangeInitialPasswordResult> {
  let output: ChangeInitialPasswordResult | undefined;

  await act(async () => {
    output = await mutation.mutateAsync({ password: PASSWORD });
  });

  if (output === undefined) throw new Error("mutation sem resultado");
  return output;
}

beforeEach(() => {
  invokeMock.mockReset();
  refreshSessionMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useChangeInitialPassword — requisição", () => {
  it("envia só { password }: nenhum id, papel ou flag no corpo", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const { result } = renderChangeInitialPassword();
    await runMutation(result.current);

    expect(invokeMock).toHaveBeenCalledTimes(1);

    const [name, options] = invokeMock.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(name).toBe("change-password");
    expect(Object.keys(options.body)).toEqual(["password"]);
    expect(options.body).toEqual({ password: PASSWORD });
  });
});

describe("useChangeInitialPassword — sucesso", () => {
  it("200 renova a sessão e devolve as claims do token novo", async () => {
    const accessToken = tokenWith(claimsPayload({ user_role: "admin" }));
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: accessToken } },
      error: null,
    });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(output).toEqual({
      ok: true,
      claims: {
        role: "admin",
        tenantId: TENANT_ID,
        mustChangePassword: false,
      },
    });
  });

  it("409 password_change_not_required é sucesso: renova e devolve claims", async () => {
    const accessToken = tokenWith(claimsPayload());
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(
        409,
        JSON.stringify({
          error: "password_change_not_required",
          code: "password_change_not_required",
        }),
      ),
    });
    refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: accessToken } },
      error: null,
    });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(output.claims).toEqual({
      role: "professional",
      tenantId: TENANT_ID,
      mustChangePassword: false,
    });
  });

  it("refreshSession falho: mutation não falha e devolve claims null", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: new Error("refresh_failed"),
    });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(output.ok).toBe(true);
    expect(output.claims).toBeNull();
  });

  it("refreshSession sem access_token: claims null (nunca token vazio)", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    refreshSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(output.claims).toBeNull();
  });
});

describe("useChangeInitialPassword — 409 sem código (fail-closed)", () => {
  it("409 sem corpo legível vira erro, não sucesso", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(409, null),
    });

    const { result } = renderChangeInitialPassword();

    await act(async () => {
      await expect(
        result.current.mutateAsync({ password: PASSWORD }),
      ).rejects.toMatchObject({ message: "change_password_failed", status: 409 });
    });

    // Token defasado não é liberado: sem renovação.
    expect(refreshSessionMock).not.toHaveBeenCalled();

    const failure = result.current.error;
    expect(failure).toBeInstanceOf(Error);
    expect(mapInitialPasswordError(failure)).toBe(
      "Não foi possível salvar a nova senha. Tente novamente.",
    );
  });

  it("409 com código desconhecido também vira erro genérico", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(409, JSON.stringify({ code: "conflict" })),
    });

    const { result } = renderChangeInitialPassword();

    await act(async () => {
      await expect(
        result.current.mutateAsync({ password: PASSWORD }),
      ).rejects.toMatchObject({
        message: "change_password_failed",
        status: 409,
        code: "conflict",
      });
    });

    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(mapInitialPasswordError(result.current.error)).toBe(
      "Não foi possível salvar a nova senha. Tente novamente.",
    );
  });
});
