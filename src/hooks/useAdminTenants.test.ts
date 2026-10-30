import { describe, expect, it } from "vitest";

import { normalizeInvokeError } from "@/hooks/useAdminTenants";
import { mapSubscriptionError } from "@/lib/subscription-errors";

/**
 * CA-07 / AC-07.2: o corpo não-2xx do `functions.invoke("admin-subscription")`
 * (um `FunctionsHttpError`) vive em `error.context` (uma `Response`), não em
 * `error.message`. Os testes antigos alimentavam shapes sintéticos
 * (`{ message: "...409..." }`) que o runtime nunca produz; aqui provamos o
 * caminho real: `{ context: { status, json() } }` → `normalizeInvokeError`
 * recupera status + corpo → `mapSubscriptionError` devolve a string pt-BR certa
 * (409 vira "Transição de status não permitida.", não o genérico).
 */

/** Monta um erro no formato do `FunctionsHttpError` com corpo JSON `{ error }`. */
function functionsHttpError(status: number, body: unknown): Error {
  const error = new Error("Edge Function returned a non-2xx status code");
  // `context` é uma `Response`; aqui só precisamos de `status` + `json()`.
  (error as unknown as { context: unknown }).context = {
    status,
    json: async () => body,
  };
  return error;
}

describe("normalizeInvokeError → mapSubscriptionError (CA-07, caminho real)", () => {
  it("409 (transição inválida): recupera corpo e mapeia para a mensagem pt-BR", async () => {
    const raw = functionsHttpError(409, {
      error: "Transição de status não permitida.",
    });
    const normalized = await normalizeInvokeError(raw);
    expect(normalized.status).toBe(409);
    expect(mapSubscriptionError(normalized)).toBe(
      "Transição de status não permitida.",
    );
  });

  it("403 (não é super_admin): mapeia para sem permissão", async () => {
    const normalized = await normalizeInvokeError(
      functionsHttpError(403, { error: "forbidden" }),
    );
    expect(normalized.status).toBe(403);
    expect(mapSubscriptionError(normalized)).toBe("Sem permissão para esta ação.");
  });

  it("404 (empresa inexistente): mapeia para não encontrada", async () => {
    const normalized = await normalizeInvokeError(
      functionsHttpError(404, { error: "not found" }),
    );
    expect(normalized.status).toBe(404);
    expect(mapSubscriptionError(normalized)).toBe("Empresa não encontrada.");
  });

  it("400 (payload inválido): mapeia para dados inválidos", async () => {
    const normalized = await normalizeInvokeError(
      functionsHttpError(400, { error: "bad request" }),
    );
    expect(normalized.status).toBe(400);
    expect(mapSubscriptionError(normalized)).toBe("Dados inválidos.");
  });

  it("401 (sessão expirada): mapeia para re-login", async () => {
    const normalized = await normalizeInvokeError(
      functionsHttpError(401, { error: "unauthorized" }),
    );
    expect(normalized.status).toBe(401);
    expect(mapSubscriptionError(normalized)).toBe(
      "Sua sessão expirou. Entre novamente.",
    );
  });

  it("resolve o status mesmo quando o corpo é ilegível (json() lança)", async () => {
    const raw = new Error("Edge Function returned a non-2xx status code");
    (raw as unknown as { context: unknown }).context = {
      status: 409,
      json: async () => {
        throw new Error("corpo já consumido");
      },
    };
    const normalized = await normalizeInvokeError(raw);
    expect(normalized.status).toBe(409);
    // Só com o status (409) já resolve a transição — não cai no genérico.
    expect(mapSubscriptionError(normalized)).toBe(
      "Transição de status não permitida.",
    );
  });

  it("sem context/status válido: degrada para erro genérico sem lançar", async () => {
    const normalized = await normalizeInvokeError({ message: "network down" });
    expect(normalized.status).toBeUndefined();
    expect(mapSubscriptionError(normalized)).toBe(
      "Não foi possível atualizar a assinatura. Tente novamente.",
    );
  });
});
