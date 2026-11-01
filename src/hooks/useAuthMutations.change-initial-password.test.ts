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
 * Contrato de `useChangeInitialPassword` (ADR-09, corrigido no QA da ADR-14).
 *
 * 1. O corpo do `functions.invoke` leva SÓ `password` — o usuário vem do JWT.
 * 2. O e-mail é lido da sessão ANTES do invoke: o GoTrue revoga as sessões ao
 *    trocar a senha, então depois do 200 o `getSession()` pode voltar vazio.
 * 3. 200: a sessão nova nasce de `signInWithPassword` com a senha nova (o
 *    `refreshSession` responderia 400) e as claims devolvidas são do token novo.
 * 4. 409 só é sucesso com o código estável `password_change_not_required`
 *    (fail-closed): a senha não mudou, então o caminho é `refreshSession`.
 * 5. Login/renovação falhos não derrubam a mutation, mas devolvem `claims: null`
 *    (a senha já foi salva; a tela da ADR-10 decide pedir login de novo).
 *
 * Supabase inteiro é mockado: nenhuma rede.
 */

const { invokeMock, refreshSessionMock, getSessionMock, signInMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    refreshSessionMock: vi.fn(),
    getSessionMock: vi.fn(),
    signInMock: vi.fn(),
  }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      refreshSession: refreshSessionMock,
      getSession: getSessionMock,
      signInWithPassword: signInMock,
    },
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/hooks/useSession", () => ({ sessionQueryKey: ["session"] }));

const PASSWORD = "senha-nova-1";
const EMAIL = "admin@empresa.test";

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
  getSessionMock.mockReset();
  signInMock.mockReset();

  getSessionMock.mockResolvedValue({
    data: { session: { user: { email: EMAIL } } },
    error: null,
  });
  signInMock.mockResolvedValue({ data: { session: null }, error: null });
  refreshSessionMock.mockResolvedValue({ data: { session: null }, error: null });
});

afterEach(() => {
  cleanup();
});

describe("useChangeInitialPassword — requisição", () => {
  it("envia só { password }: nenhum id, papel ou flag no corpo", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

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

  it("lê o e-mail da sessão antes do invoke", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    const { result } = renderChangeInitialPassword();
    await runMutation(result.current);

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      invokeMock.mock.invocationCallOrder[0],
    );
  });
});

describe("useChangeInitialPassword — sucesso 200 (sessões revogadas)", () => {
  it("relogin com a senha nova devolve as claims do token novo", async () => {
    const accessToken = tokenWith(claimsPayload({ user_role: "admin" }));
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    signInMock.mockResolvedValue({
      data: { session: { access_token: accessToken } },
      error: null,
    });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
    // refreshSession responderia 400 com as sessões revogadas.
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(output).toEqual({
      ok: true,
      claims: {
        role: "admin",
        tenantId: TENANT_ID,
        mustChangePassword: false,
      },
    });
  });

  it("relogin falho: mutation não falha e devolve claims null", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    signInMock.mockResolvedValue({
      data: { session: null },
      error: new Error("invalid_credentials"),
    });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(output.ok).toBe(true);
    expect(output.claims).toBeNull();
  });

  it("relogin que lança (transporte): mutation não falha e devolve claims null", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    signInMock.mockRejectedValue(new Error("network_down"));

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(output.ok).toBe(true);
    expect(output.claims).toBeNull();
  });

  it("relogin sem access_token: claims null (nunca token vazio)", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    signInMock.mockResolvedValue({ data: { session: null }, error: null });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(output.claims).toBeNull();
  });

  it("sessão sem e-mail: não tenta relogin e devolve claims null", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(signInMock).not.toHaveBeenCalled();
    expect(output).toEqual({ ok: true, claims: null });
  });
});

describe("useChangeInitialPassword — 409 password_change_not_required", () => {
  it("a senha não mudou: renova a sessão e devolve claims", async () => {
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
    expect(signInMock).not.toHaveBeenCalled();
    expect(output.claims).toEqual({
      role: "professional",
      tenantId: TENANT_ID,
      mustChangePassword: false,
    });
  });

  it("refreshSession falho no 409: mutation não falha e devolve claims null", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(
        409,
        JSON.stringify({ code: "password_change_not_required" }),
      ),
    });
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: new Error("refresh_failed"),
    });

    const { result } = renderChangeInitialPassword();
    const output = await runMutation(result.current);

    expect(output.ok).toBe(true);
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

    // Token defasado não é liberado: sem renovação e sem relogin.
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();

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
    expect(signInMock).not.toHaveBeenCalled();
    expect(mapInitialPasswordError(result.current.error)).toBe(
      "Não foi possível salvar a nova senha. Tente novamente.",
    );
  });
});
