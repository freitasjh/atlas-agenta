import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { AuthSession } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { applyAuthEvent } from "@/lib/auth-cache";

/**
 * ADR-02: limpeza do cache de dados no login/logout (RF-11, AC-15).
 * QueryClient real, sem rede.
 */

function sessionOf(userId: string): AuthSession {
  return {
    access_token: `token-${userId}`,
    user: { id: userId },
  } as unknown as AuthSession;
}

function seedCache(queryClient: QueryClient): void {
  queryClient.setQueryData(["profile", "user-1"], { role: "admin" });
  queryClient.setQueryData(["tenant", "tenant-1"], { trade_name: "Studio" });
  queryClient.setQueryData(["customers"], [{ id: "c-1" }]);
  queryClient.setQueryData(["appointments"], [{ id: "a-1" }]);
  queryClient.setQueryData(["session"], sessionOf("user-1"));
}

describe("applyAuthEvent", () => {
  it("SIGNED_OUT esvazia profile, tenant, customers e appointments (sem dados)", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);

    applyAuthEvent(queryClient, "SIGNED_OUT", null);

    expect(queryClient.getQueryData(["profile", "user-1"])).toBeUndefined();
    expect(queryClient.getQueryData(["tenant", "tenant-1"])).toBeUndefined();
    expect(queryClient.getQueryData(["customers"])).toBeUndefined();
    expect(queryClient.getQueryData(["appointments"])).toBeUndefined();
  });

  it("SIGNED_OUT com observador montado não expõe dados nem dispara queryFn no re-render", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["customers"], [{ id: "A-cliente" }]);
    queryClient.setQueryData(["session"], sessionOf("user-1"));
    // Simula a tela de clientes montada: observador ativo, sem refetch no mount.
    const queryFn = vi.fn(async () => [{ id: "B-cliente" }]);
    const observer = new QueryObserver(queryClient, {
      queryKey: ["customers"],
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(observer.getCurrentResult().data).toEqual([{ id: "A-cliente" }]);

      applyAuthEvent(queryClient, "SIGNED_OUT", null);
      expect(observer.getCurrentResult().data).toBeUndefined();

      // Re-render da tela ainda montada: não pode buscar dados sem sessão.
      observer.setOptions({
        queryKey: ["customers"],
        queryFn,
        staleTime: Infinity,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(queryFn).not.toHaveBeenCalled();
      expect(observer.getCurrentResult().data).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });

  it("SIGNED_OUT mantém a chave session existindo com valor null", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);

    applyAuthEvent(queryClient, "SIGNED_OUT", null);

    expect(queryClient.getQueryCache().find({ queryKey: ["session"] })).toBeDefined();
    expect(queryClient.getQueryData(["session"])).toBeNull();
  });

  it("SIGNED_IN do mesmo usuário não remove nenhuma query", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);
    const renewed = sessionOf("user-1");

    applyAuthEvent(queryClient, "SIGNED_IN", renewed);

    expect(queryClient.getQueryData(["profile", "user-1"])).toEqual({ role: "admin" });
    expect(queryClient.getQueryData(["tenant", "tenant-1"])).toEqual({ trade_name: "Studio" });
    expect(queryClient.getQueryData(["customers"])).toEqual([{ id: "c-1" }]);
    expect(queryClient.getQueryData(["appointments"])).toEqual([{ id: "a-1" }]);
    expect(queryClient.getQueryData(["session"])).toEqual(renewed);
  });

  it("SIGNED_IN sem ['session'] prévia no cache preserva os dados e grava a sessão", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["profile", "user-1"], { role: "admin" });
    queryClient.setQueryData(["tenant", "tenant-1"], { trade_name: "Studio" });
    queryClient.setQueryData(["customers"], [{ id: "c-1" }]);
    queryClient.setQueryData(["appointments"], [{ id: "a-1" }]);
    const restored = sessionOf("user-1");
    applyAuthEvent(queryClient, "SIGNED_IN", restored);
    expect(queryClient.getQueryData(["profile", "user-1"])).toEqual({ role: "admin" });
    expect(queryClient.getQueryData(["tenant", "tenant-1"])).toEqual({ trade_name: "Studio" });
    expect(queryClient.getQueryData(["customers"])).toEqual([{ id: "c-1" }]);
    expect(queryClient.getQueryData(["appointments"])).toEqual([{ id: "a-1" }]);
    expect(queryClient.getQueryData(["session"])).toEqual(restored);
  });

  it("SIGNED_IN de outro usuário remove os dados da conta anterior e grava a nova sessão", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);
    const newSession = sessionOf("user-2");

    applyAuthEvent(queryClient, "SIGNED_IN", newSession);

    expect(queryClient.getQueryData(["profile", "user-1"])).toBeUndefined();
    expect(queryClient.getQueryData(["tenant", "tenant-1"])).toBeUndefined();
    expect(queryClient.getQueryData(["customers"])).toBeUndefined();
    expect(queryClient.getQueryData(["appointments"])).toBeUndefined();
    expect(queryClient.getQueryData(["session"])).toEqual(newSession);
  });

  it("SIGNED_IN de outro usuário não deixa observador montado com dados da conta anterior", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["customers"], [{ id: "A-cliente" }]);
    queryClient.setQueryData(["session"], sessionOf("user-1"));

    // Simula a tela de clientes montada: observador ativo sem refetch no mount.
    const observer = new QueryObserver(queryClient, {
      queryKey: ["customers"],
      queryFn: async () => [{ id: "B-cliente" }],
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      expect(observer.getCurrentResult().data).toEqual([{ id: "A-cliente" }]);

      applyAuthEvent(queryClient, "SIGNED_IN", sessionOf("user-2"));

      // Logo após o reset, nenhum dado da conta anterior pode aparecer.
      expect(observer.getCurrentResult().data).not.toEqual([{ id: "A-cliente" }]);

      // Depois do refetch, a tela recebe a conta nova.
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data).toEqual([{ id: "B-cliente" }]);
      });
    } finally {
      unsubscribe();
    }
  });

  it("SIGNED_IN de outro usuário não refaz o perfil da conta anterior", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["profile", "user-1"], { role: "admin" });
    queryClient.setQueryData(["session"], sessionOf("user-1"));

    // Simula o guard com o perfil de user-1 montado.
    const profileFetch = vi.fn(async () => ({ role: "professional" }));
    const observer = new QueryObserver(queryClient, {
      queryKey: ["profile", "user-1"],
      queryFn: profileFetch,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      applyAuthEvent(queryClient, "SIGNED_IN", sessionOf("user-2"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(profileFetch).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(["profile", "user-1"])).toBeUndefined();
      expect(queryClient.getQueryCache().find({ queryKey: ["profile", "user-1"] })).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });

  it("SIGNED_IN após SIGNED_OUT do mesmo usuário não limpa o cache recarregado", () => {
    const queryClient = new QueryClient();
    seedCache(queryClient);

    applyAuthEvent(queryClient, "SIGNED_OUT", null);
    queryClient.setQueryData(["customers"], [{ id: "c-2" }]);

    applyAuthEvent(queryClient, "SIGNED_IN", sessionOf("user-1"));

    expect(queryClient.getQueryData(["customers"])).toEqual([{ id: "c-2" }]);
    expect(queryClient.getQueryData(["session"])).toEqual(sessionOf("user-1"));
  });
});
