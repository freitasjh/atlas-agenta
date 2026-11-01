// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSignUp, type SignUpResult } from "@/hooks/useAuthMutations";
import { mapSignUpError } from "@/lib/auth-errors";
import type { SignupInput } from "@/lib/validations/auth";

/**
 * Contrato de `useSignUp` (ADR-03).
 *
 * 1. O cadastro chama a Edge Function `signup-tenant` — nunca o cadastro
 *    nativo do Auth (o trigger `handle_new_user` não existe mais; o cliente
 *    criaria usuário sem empresa).
 * 2. O corpo leva SÓ os campos da ADR-02: `email`, `password`, `trade_name`,
 *    `segment`. Nada de `role`, `tenant_id`, `app_metadata` nem `full_name`.
 * 3. Em sucesso, o login automático usa o MESMO e-mail e a MESMA senha e a
 *    sessão resultante é devolvida (destino pós-login = ADR-08).
 * 4. Se o login automático falha, a mutation NÃO falha: devolve
 *    `{ session: null }` — a conta já existe e a tela manda para `/login`.
 * 5. Erro do invoke sobe normalizado em `{ status, code }`, para
 *    `mapSignUpError` traduzir; a senha não acompanha o erro.
 *
 * Supabase inteiro é mockado: nenhuma rede.
 */

const { invokeMock, signInWithPasswordMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: invokeMock },
    auth: { signInWithPassword: signInWithPasswordMock },
  },
}));

vi.mock("@/hooks/useSession", () => ({ sessionQueryKey: ["session"] }));

const SIGNUP_INPUT: SignupInput = {
  tradeName: "Clínica Bem Viver",
  segment: "clinica",
  email: "ana@clinica.test",
  password: "senha-segura-1",
  confirmPassword: "senha-segura-1",
};

const SESSION = {
  access_token: "token-de-teste",
  refresh_token: "refresh-de-teste",
  user: { id: "user-1" },
};

/** Erro no shape do `FunctionsHttpError`: `context` é a `Response`. */
function functionsHttpError(status: number, body: string | null) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(body, { status }),
  };
}

function renderSignUp() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  const { result } = renderHook(() => useSignUp(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });

  return { result, queryClient };
}

async function runMutation(
  mutation: ReturnType<typeof useSignUp>,
): Promise<SignUpResult> {
  let output: SignUpResult | undefined;

  await act(async () => {
    output = await mutation.mutateAsync(SIGNUP_INPUT);
  });

  if (output === undefined) throw new Error("mutation sem resultado");
  return output;
}

beforeEach(() => {
  invokeMock.mockReset();
  signInWithPasswordMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useSignUp — requisição", () => {
  it("chama a Edge Function signup-tenant, nunca o cadastro nativo do Auth", async () => {
    invokeMock.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    signInWithPasswordMock.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });

    const { result } = renderSignUp();
    await runMutation(result.current);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("signup-tenant");
  });

  it("envia só { email, password, trade_name, segment }", async () => {
    invokeMock.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    signInWithPasswordMock.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });

    const { result } = renderSignUp();
    await runMutation(result.current);

    const [, options] = invokeMock.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];

    expect(Object.keys(options.body).sort()).toEqual([
      "email",
      "password",
      "segment",
      "trade_name",
    ]);
    expect(options.body).toEqual({
      email: SIGNUP_INPUT.email,
      password: SIGNUP_INPUT.password,
      trade_name: SIGNUP_INPUT.tradeName,
      segment: SIGNUP_INPUT.segment,
    });
    // Nenhum campo de papel/tenant/empresa-no-metadado sai do cliente.
    for (const forbidden of [
      "role",
      "tenant_id",
      "app_metadata",
      "user_metadata",
      "full_name",
      "confirmPassword",
      "tradeName",
    ]) {
      expect(options.body).not.toHaveProperty(forbidden);
    }
  });
});

describe("useSignUp — sucesso", () => {
  it("faz login automático com o mesmo e-mail e senha e devolve a sessão", async () => {
    invokeMock.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    signInWithPasswordMock.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });

    const { result } = renderSignUp();
    const output = await runMutation(result.current);

    expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: SIGNUP_INPUT.email,
      password: SIGNUP_INPUT.password,
    });
    expect(output.session).toEqual(SESSION);
  });

  it("login sem sessão e sem erro devolve session null (conta criada, sem sessão)", async () => {
    invokeMock.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    signInWithPasswordMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const { result } = renderSignUp();
    const output = await runMutation(result.current);

    expect(output.session).toBeNull();
  });

  it("login automático falho não derruba a mutation: session null", async () => {
    invokeMock.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    signInWithPasswordMock.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error("invalid_credentials"), {
        code: "invalid_credentials",
      }),
    });

    const { result } = renderSignUp();
    const output = await runMutation(result.current);

    expect(output.session).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("login automático que LANÇA (não-AuthError) não derruba a mutation: session null", async () => {
    invokeMock.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    // Falha de transporte/biblioteca não vem como `{ error }`: sobe como throw.
    signInWithPasswordMock.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderSignUp();
    const output = await runMutation(result.current);

    expect(output.session).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useSignUp — erros do cadastro", () => {
  it("409 email_ja_cadastrado sobe normalizado e não tenta login", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(
        409,
        JSON.stringify({
          code: "email_ja_cadastrado",
          message: "Este e-mail já tem cadastro.",
        }),
      ),
    });

    const { result } = renderSignUp();

    await act(async () => {
      await expect(
        result.current.mutateAsync(SIGNUP_INPUT),
      ).rejects.toMatchObject({
        message: "signup_failed",
        status: 409,
        code: "email_ja_cadastrado",
      });
    });

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(mapSignUpError(result.current.error)).toBe(
      "Este e-mail já tem cadastro.",
    );
  });

  it("erro sem corpo legível vira genérico e não tenta login", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(500, null),
    });

    const { result } = renderSignUp();

    await act(async () => {
      await expect(
        result.current.mutateAsync(SIGNUP_INPUT),
      ).rejects.toMatchObject({ message: "signup_failed", status: 500 });
    });

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(mapSignUpError(result.current.error)).toBe(
      "Não foi possível criar sua conta. Tente novamente.",
    );
  });

  it("o erro não carrega a senha", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(500, JSON.stringify({ code: "cadastro_falhou" })),
    });

    const { result } = renderSignUp();

    await act(async () => {
      await expect(result.current.mutateAsync(SIGNUP_INPUT)).rejects.toThrow();
    });

    expect(JSON.stringify(result.current.error)).not.toContain(
      SIGNUP_INPUT.password,
    );
  });
});
