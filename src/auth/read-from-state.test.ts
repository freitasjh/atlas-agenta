import { describe, expect, it } from "vitest";

import { readFromState } from "@/auth/read-from-state";

/**
 * Contrato de `readFromState` (ADR-08): traduz `location.state` — que os
 * guards gravam como objeto `Location` — para a string `pathname + search`
 * que `resolvePostLoginDestination` consome. Qualquer formato desconhecido
 * vira `undefined`, e o destino cai na regra do papel.
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
