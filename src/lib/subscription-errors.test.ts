import { describe, expect, it } from "vitest";

import { mapSubscriptionError } from "@/lib/subscription-errors";

/**
 * AC-04.4: cada condição (403/409/404/401/400/genérico) devolve a string pt-BR
 * esperada; shape desconhecido cai no genérico sem lançar. Dado não confiável
 * do canal de erro do `functions.invoke`.
 */

describe("mapSubscriptionError (AC-04.4)", () => {
  it("401 / sessão expirada", () => {
    expect(mapSubscriptionError({ message: "Error 401 unauthorized" })).toBe(
      "Sua sessão expirou. Entre novamente.",
    );
  });

  it("403 / sem permissão", () => {
    expect(mapSubscriptionError({ error: "403 forbidden" })).toBe(
      "Sem permissão para esta ação.",
    );
  });

  it("409 / transição inválida", () => {
    expect(
      mapSubscriptionError({ message: "HTTP 409 transição não permitida" }),
    ).toBe("Transição de status não permitida.");
  });

  it("404 / empresa não encontrada", () => {
    expect(mapSubscriptionError({ error: "404 not found" })).toBe(
      "Empresa não encontrada.",
    );
  });

  it("400 / payload inválido", () => {
    expect(mapSubscriptionError({ message: "400 bad request" })).toBe(
      "Dados inválidos.",
    );
  });

  it("shape desconhecido cai no genérico sem lançar", () => {
    expect(mapSubscriptionError(null)).toBe(
      "Não foi possível atualizar a assinatura. Tente novamente.",
    );
    expect(mapSubscriptionError(undefined)).toBe(
      "Não foi possível atualizar a assinatura. Tente novamente.",
    );
    expect(mapSubscriptionError(42)).toBe(
      "Não foi possível atualizar a assinatura. Tente novamente.",
    );
    expect(mapSubscriptionError({ foo: "bar" })).toBe(
      "Não foi possível atualizar a assinatura. Tente novamente.",
    );
  });

  it("aceita erro como string crua", () => {
    expect(mapSubscriptionError("algo deu 500 interno")).toBe(
      "Não foi possível atualizar a assinatura. Tente novamente.",
    );
  });
});
