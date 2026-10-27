import { QueryClient } from "@tanstack/react-query";
import type { AuthSession } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { applyAuthEvent } from "@/lib/auth-cache";

/**
 * ADR-02: limpeza do cache de dados no evento SIGNED_OUT (RF-11, AC-15).
 * QueryClient real, sem rede.
 */

const fakeSession = { access_token: "token-fake" } as unknown as AuthSession;

function seedCache(queryClient: QueryClient): void {
  queryClient.setQueryData(["profile", "user-1"], { role: "admin" });
  queryClient.setQueryData(["tenant", "tenant-1"], { trade_name: "Studio" });
  queryClient.setQueryData(["customers"], [{ id: "c-1" }]);
  queryClient.setQueryData(["appointments"], [{ id: "a-1" }]);
  queryClient.setQueryData(["session"], fakeSession);
}

describe("applyAuthEvent", () => {
  it("SIGNED_OUT remove profile, tenant, customers e appointments", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);

    applyAuthEvent(queryClient, "SIGNED_OUT", null);

    expect(queryClient.getQueryData(["profile", "user-1"])).toBeUndefined();
    expect(queryClient.getQueryData(["tenant", "tenant-1"])).toBeUndefined();
    expect(queryClient.getQueryData(["customers"])).toBeUndefined();
    expect(queryClient.getQueryData(["appointments"])).toBeUndefined();
    expect(queryClient.getQueryCache().find({ queryKey: ["profile"] })).toBeUndefined();
    expect(queryClient.getQueryCache().find({ queryKey: ["customers"] })).toBeUndefined();
  });

  it("SIGNED_OUT mantém a chave session existindo com valor null", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);

    applyAuthEvent(queryClient, "SIGNED_OUT", null);

    expect(queryClient.getQueryCache().find({ queryKey: ["session"] })).toBeDefined();
    expect(queryClient.getQueryData(["session"])).toBeNull();
  });

  it("SIGNED_IN não remove nenhuma query e grava a sessão", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);

    applyAuthEvent(queryClient, "SIGNED_IN", fakeSession);

    expect(queryClient.getQueryData(["profile", "user-1"])).toEqual({ role: "admin" });
    expect(queryClient.getQueryData(["tenant", "tenant-1"])).toEqual({ trade_name: "Studio" });
    expect(queryClient.getQueryData(["customers"])).toEqual([{ id: "c-1" }]);
    expect(queryClient.getQueryData(["appointments"])).toEqual([{ id: "a-1" }]);
    expect(queryClient.getQueryData(["session"])).toBe(fakeSession);
  });
});
