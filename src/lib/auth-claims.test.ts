import { describe, expect, it } from "vitest";

import { parseAuthClaims, type AuthClaims } from "@/lib/auth-claims";
import {
  claimsPayload,
  TENANT_ID,
  tokenWith,
} from "@/test/fixtures/auth-token";

/**
 * Contrato de `parseAuthClaims` (ADR-07): a identidade do cliente vem das
 * claims do access token (`user_role`, `tenant_id`, `must_change_password`),
 * emitidas pelo hook `custom-access-token` (ADR-01).
 *
 * Regra dura: a função NUNCA lança. Token malformado, claim ausente, enum
 * inválido, `tenant_id` fora do formato UUID ou flag não-booleana degradam
 * para `null` — o agregador traduz `null` em `hasIdentityError` e o guard
 * encerra a sessão (fail-closed).
 */

describe("parseAuthClaims", () => {
  it("token válido devolve as claims normalizadas", () => {
    const claims = parseAuthClaims(tokenWith(claimsPayload()));

    expect(claims).toEqual({
      role: "professional",
      tenantId: TENANT_ID,
      mustChangePassword: false,
    } satisfies AuthClaims);
  });

  it("tenant_id nulo (super_admin) é claim válida", () => {
    const claims = parseAuthClaims(
      tokenWith(claimsPayload({ user_role: "super_admin", tenant_id: null })),
    );

    expect(claims).toEqual({
      role: "super_admin",
      tenantId: null,
      mustChangePassword: false,
    } satisfies AuthClaims);
  });

  it("must_change_password true vem como boolean", () => {
    const claims = parseAuthClaims(
      tokenWith(claimsPayload({ must_change_password: true })),
    );

    expect(claims?.mustChangePassword).toBe(true);
  });

  it("claim user_role ausente ⇒ null (sessão emitida antes do hook)", () => {
    const payload = claimsPayload();
    delete payload.user_role;

    expect(parseAuthClaims(tokenWith(payload))).toBeNull();
  });

  it("claim must_change_password ausente ⇒ null", () => {
    const payload = claimsPayload();
    delete payload.must_change_password;

    expect(parseAuthClaims(tokenWith(payload))).toBeNull();
  });

  it("claim tenant_id ausente ⇒ null (não confunde ausência com null)", () => {
    const payload = claimsPayload();
    delete payload.tenant_id;

    expect(parseAuthClaims(tokenWith(payload))).toBeNull();
  });

  it('tenant_id não-UUID ("nao-uuid") ⇒ null (claim corrompida)', () => {
    expect(
      parseAuthClaims(tokenWith(claimsPayload({ tenant_id: "nao-uuid" }))),
    ).toBeNull();
  });

  it("tenant_id numérico (123) ⇒ null (contrato é string UUID)", () => {
    expect(
      parseAuthClaims(
        tokenWith({ ...claimsPayload(), tenant_id: 123 as unknown as string }),
      ),
    ).toBeNull();
  });

  it("user_role fora do enum ⇒ null", () => {
    expect(
      parseAuthClaims(tokenWith({ ...claimsPayload(), user_role: "owner" })),
    ).toBeNull();
  });

  it('must_change_password como string "true" ⇒ null (não é boolean)', () => {
    expect(
      parseAuthClaims(
        tokenWith({ ...claimsPayload(), must_change_password: "true" }),
      ),
    ).toBeNull();
  });

  it("payload base64url inválido ⇒ null, sem lançar", () => {
    expect(() => parseAuthClaims("header.%%%nao-base64%%%.sig")).not.toThrow();
    expect(parseAuthClaims("header.%%%nao-base64%%%.sig")).toBeNull();
  });

  it("payload que não é JSON ⇒ null", () => {
    const body = btoa("not-json")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(parseAuthClaims(`header.${body}.sig`)).toBeNull();
  });

  it("token sem os dois pontos (menos de 3 partes) ⇒ null", () => {
    expect(parseAuthClaims("token-sem-dois-pontos")).toBeNull();
    expect(parseAuthClaims("")).toBeNull();
  });

  it("nunca lê user_metadata: papel ali não conta como claim", () => {
    const payload = claimsPayload();
    delete payload.user_role;
    payload.user_metadata = { user_role: "admin" };

    expect(parseAuthClaims(tokenWith(payload))).toBeNull();
  });
});
