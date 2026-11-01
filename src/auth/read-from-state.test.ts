import { describe, expect, it } from "vitest";

import { readFromState, readNoticeState } from "@/auth/read-from-state";

/**
 * Contrato de `readFromState` (ADR-08/ADR-11): normaliza `location.state.from`
 * para a string `pathname + search` que `resolvePostLoginDestination` consome.
 * Os guards gravam string desde a ADR-11; o formato antigo (objeto `Location`)
 * continua aceito para estados de navegação legados. Qualquer formato
 * desconhecido vira `undefined`, e o destino cai na regra do papel.
 */

describe("readFromState", () => {
  it("state com from string ⇒ repassa a string sem alterar", () => {
    expect(readFromState({ from: "/app/agenda?date=2026-10-31" })).toBe(
      "/app/agenda?date=2026-10-31",
    );
  });

  it("from como Location ⇒ concatena pathname + search", () => {
    expect(
      readFromState({ from: { pathname: "/app/agenda", search: "?date=2026-10-31" } }),
    ).toBe("/app/agenda?date=2026-10-31");
  });

  it("from sem search ⇒ só o pathname", () => {
    expect(readFromState({ from: { pathname: "/app/agenda" } })).toBe("/app/agenda");
  });

  it("from como objeto sem pathname ⇒ undefined", () => {
    expect(readFromState({ from: { search: "?date=2026-10-31" } })).toBeUndefined();
  });

  it("state nulo ⇒ undefined", () => {
    expect(readFromState(null)).toBeUndefined();
  });

  it("state numérico ⇒ undefined", () => {
    expect(readFromState(42)).toBeUndefined();
  });
});

/**
 * `readNoticeState` leva o aviso curto de uma tela para outra pelo
 * `location.state` (ADR-03: conta criada mas login automático falhou → `/login`
 * mostra "Conta criada. Entre com seu e-mail e senha."). `state` é entrada não
 * confiável: só string curta e não vazia vira aviso; nada é injetado como HTML.
 */
describe("readNoticeState", () => {
  it("state com notice string ⇒ devolve o texto", () => {
    expect(
      readNoticeState({ notice: "Conta criada. Entre com seu e-mail e senha." }),
    ).toBe("Conta criada. Entre com seu e-mail e senha.");
  });

  it("notice com espaços nas pontas ⇒ devolve aparado", () => {
    expect(readNoticeState({ notice: "  Conta criada.  " })).toBe("Conta criada.");
  });

  it("notice vazio ou só espaços ⇒ null", () => {
    expect(readNoticeState({ notice: "" })).toBeNull();
    expect(readNoticeState({ notice: "   " })).toBeNull();
  });

  it("notice não-string ⇒ null", () => {
    expect(readNoticeState({ notice: 42 })).toBeNull();
    expect(readNoticeState({ notice: { text: "x" } })).toBeNull();
  });

  it("notice acima do limite ⇒ null (state não confiável)", () => {
    expect(readNoticeState({ notice: "a".repeat(281) })).toBeNull();
  });

  it("state sem notice, nulo ou primitivo ⇒ null", () => {
    expect(readNoticeState({ from: "/app" })).toBeNull();
    expect(readNoticeState(null)).toBeNull();
    expect(readNoticeState("aviso")).toBeNull();
  });
});
