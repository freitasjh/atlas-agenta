// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  USER_AUDIT_ACTIONS,
  useUserAuditLog,
} from "@/hooks/useUserAuditLog";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));

function selectChain(rows: unknown) {
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const order = vi.fn(() => ({ limit }));
  // biome-ignore lint/suspicious/noExplicitAny: cadeia dinâmica do mock.
  const chain: any = { order, limit };
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  return {
    select: vi.fn(() => ({
      in: vi.fn(() => chain),
    })),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: extrai a cadeia do mock.
function getChain(): any {
  const fromVal = fromMock.mock.results[0]?.value as { select: ReturnType<typeof vi.fn> };
  const selectVal = fromVal.select.mock.results[0]?.value as { in: ReturnType<typeof vi.fn> };
  return selectVal.in.mock.results[0]?.value;
}

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return { result, queryClient };
}

const ROWS = [
  {
    id: "u1",
    tenant_id: "t1",
    actor_id: "ator-1",
    action: "invitation.created",
    target_type: "invitation",
    target_id: "i1",
    metadata: {},
    created_at: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "u2",
    tenant_id: "t1",
    actor_id: "ator-2",
    action: "user.role_changed",
    target_type: "profile",
    target_id: "p1",
    metadata: {},
    created_at: "2026-11-02T10:00:00.000Z",
  },
  {
    id: "u3",
    tenant_id: "t1",
    actor_id: "ator-1",
    action: "professional.linked",
    target_type: "professional",
    target_id: "pr1",
    metadata: {},
    created_at: "2026-11-03T10:00:00.000Z",
  },
];

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockReturnValue(selectChain(ROWS));
});

afterEach(() => {
  cleanup();
});

describe("USER_AUDIT_ACTIONS", () => {
  it("cobre as 9 ações de usuário (ADR-002)", () => {
    expect([...USER_AUDIT_ACTIONS].sort()).toEqual(
      [
        "invitation.accepted",
        "invitation.created",
        "invitation.resent",
        "invitation.revoked",
        "professional.linked",
        "professional.unlinked",
        "user.deactivated",
        "user.reactivated",
        "user.role_changed",
      ].sort(),
    );
  });
});

describe("useUserAuditLog", () => {
  it("filtra server-side por ações de usuário via .in (sem tenant_id do cliente)", async () => {
    const { result } = renderWithClient(() => useUserAuditLog());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("audit_log");
    const selectFn = fromMock.mock.results[0]?.value.select as ReturnType<typeof vi.fn>;
    expect(selectFn).toHaveBeenCalled();
    const inFn = selectFn.mock.results[0]?.value.in as ReturnType<typeof vi.fn>;
    expect(inFn).toHaveBeenCalledWith("action", [...USER_AUDIT_ACTIONS]);
    expect(result.current.data).toHaveLength(3);
  });

  it("nunca envia tenant_id como filtro do cliente", async () => {
    const { result } = renderWithClient(() => useUserAuditLog());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calls = JSON.stringify(fromMock.mock.calls);
    expect(calls).not.toContain("tenant_id");
  });

  it("busca por ator (substring, case-insensitive)", async () => {
    const { result } = renderWithClient(() => useUserAuditLog({ actor: "ATOR-1" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it("filtra por ação client-side", async () => {
    const { result } = renderWithClient(() =>
      useUserAuditLog({ action: "user.role_changed" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("filtra por período server-side via .gte/.lte (sem filtro client de data)", async () => {
    const { result } = renderWithClient(() =>
      useUserAuditLog({
        from: "2026-11-02T00:00:00.000Z",
        to: "2026-11-02T23:59:59.000Z",
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = getChain();
    expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-11-02T00:00:00.000Z");
    expect(chain.lte).toHaveBeenCalledWith("created_at", "2026-11-02T23:59:59.000Z");
  });

  it("limita a 500 linhas mais recentes", async () => {
    const { result } = renderWithClient(() => useUserAuditLog());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = getChain();
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(500);
  });

  it("sem período não chama .gte/.lte", async () => {
    const { result } = renderWithClient(() => useUserAuditLog());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = getChain();
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.lte).not.toHaveBeenCalled();
  });

  it("expõe loading / error / empty", async () => {
    fromMock.mockReturnValueOnce({
      select: () => ({
        in: () => {
          // biome-ignore lint/suspicious/noExplicitAny: cadeia dinâmica do mock.
          const chain: any = {};
          chain.gte = vi.fn(() => chain);
          chain.lte = vi.fn(() => chain);
          chain.order = vi.fn(() => ({
            limit: vi.fn(async () => ({ data: null, error: { message: "rls" } })),
          }));
          return chain;
        },
      }),
    });
    const { result } = renderWithClient(() => useUserAuditLog());
    await waitFor(() => expect(result.current.isError).toBe(true));

    fromMock.mockReturnValueOnce(selectChain([]));
    const empty = renderWithClient(() => useUserAuditLog());
    await waitFor(() => expect(empty.result.current.isSuccess).toBe(true));
    expect(empty.result.current.data).toHaveLength(0);
  });
});
