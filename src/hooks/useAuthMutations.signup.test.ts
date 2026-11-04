// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSignUp, type SignUpResult } from "@/hooks/useAuthMutations";
import { mapSignUpError } from "@/lib/auth-errors";
import type { SignupInput } from "@/lib/validations/auth";

/**
 * Contrato de `useSignUp` (ADR-02/ADR-03).
 *
 * 1. O cadastro chama a Edge Function `signup-tenant` — nunca o cadastro
 *    nativo do Auth (o trigger `handle_new_user` não existe mais; o cliente
 *    criaria usuário sem empresa).
 * 2. O corpo é byte-idêntico ao schema ADR-002 (`.strict()`): `email`,
 *    `password`, `trade_name`, `legal_name?`, `document` (só dígitos),
 *    `phone_empresa` (só dígitos), `address_cep` (8 dígitos), `address_street`,
 *    `address_number`, `address_complement?`, `address_city`, `address_state`
 *    (UF maiúscula), `full_name`, `segment?`. Nada de `role`, `tenant_id`,
 *    `whatsapp`, `app_metadata` nem `confirmPassword`.
 * 3. Em sucesso, o login automático usa o MESMO e-mail e a MESMA senha e a
 *    sessão resultante é devolvida (destino pós-login = ADR-08).
 * 4. Se o login automático falha, a mutation NÃO falha: devolve
 *    `{ session: null }` — a conta já existe e a tela manda para `/login`.
 * 5. Erro do invoke sobe normalizado em `{ status, code }`, para
 *    `mapSignUpError` traduzir (`document_ja_cadastrado` → mensagem exata do
 *    catálogo); a senha não acompanha o erro.
 *
 * Supabase inteiro é mockado: nenhuma rede. Dígitos fictícios de teste.
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
  tradeName: "Salão da Ana",
  legalName: "Ana Souza LTDA",
  document: "529.982.247-25",
  phoneEmpresa: "(11) 98765-4321",
  addressCep: "01310-100",
  addressStreet: "Avenida Paulista",
  addressNumber: "1000",
  addressComplement: "Sala 1",
  addressCity: "São Paulo",
  addressState: "sp",
  email: "dona@salao.com.br",
  password: "Senha@123",
  confirmPassword: "Senha@123",
  fullName: "Ana Souza",
  segment: "salao",
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

  it("envia o corpo completo idêntico ao schema ADR-002", async () => {
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

    expect(options.body).toEqual({
      email: SIGNUP_INPUT.email,
      password: SIGNUP_INPUT.password,
      trade_name: "Salão da Ana",
      legal_name: "Ana Souza LTDA",
      document: "52998224725",
      phone_empresa: "11987654321",
      address_cep: "01310100",
      address_street: "Avenida Paulista",
      address_number: "1000",
      address_complement: "Sala 1",
      address_city: "São Paulo",
      address_state: "SP",
      full_name: "Ana Souza",
      segment: "salao",
    });
    // Nenhum campo de papel/tenant/empresa-no-metadado sai do cliente.
    for (const forbidden of [
      "role",
      "tenant_id",
      "app_metadata",
      "user_metadata",
      "whatsapp",
      "confirmPassword",
      "tradeName",
      "phoneEmpresa",
      "addressCep",
    ]) {
      expect(options.body).not.toHaveProperty(forbidden);
    }
  });

  it("omite opcionais vazios (legal_name, complement, segment)", async () => {
    invokeMock.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    signInWithPasswordMock.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });

    const { result } = renderSignUp();
    await act(async () => {
      await result.current.mutateAsync({
        ...SIGNUP_INPUT,
        legalName: undefined,
        addressComplement: undefined,
        segment: undefined,
      });
    });

    const [, options] = invokeMock.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(options.body).not.toHaveProperty("legal_name");
    expect(options.body).not.toHaveProperty("address_complement");
    expect(options.body).not.toHaveProperty("segment");
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
  it("409 document_ja_cadastrado sobe normalizado e exibe a mensagem exata", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: functionsHttpError(
        409,
        JSON.stringify({
          code: "document_ja_cadastrado",
          message: "Este CNPJ/CPF já tem cadastro.",
        }),
      ),
    });

    const { result } = renderSignUp();

    let thrown: unknown;
    await act(async () => {
      thrown = await result.current.mutateAsync(SIGNUP_INPUT).catch((e) => e);
    });

    expect(thrown).toMatchObject({
      message: "signup_failed",
      status: 409,
      code: "document_ja_cadastrado",
    });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    // A tela mapeia o erro capturado do `mutateAsync` (try/catch do onSubmit).
    expect(mapSignUpError(thrown)).toBe("Este CNPJ/CPF já tem cadastro.");
  });

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

    let thrown: unknown;
    await act(async () => {
      thrown = await result.current.mutateAsync(SIGNUP_INPUT).catch((e) => e);
    });

    expect(thrown).toMatchObject({
      message: "signup_failed",
      status: 409,
      code: "email_ja_cadastrado",
    });

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(mapSignUpError(thrown)).toBe("Este e-mail já tem cadastro.");
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
