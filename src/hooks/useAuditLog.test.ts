// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAuditLog,
  filterAuditLog,
  filterAuditLogs,
  auditLogRowSchema,
} from "@/hooks/useAuditLog";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));

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
    id: "a1",
    tenant_id: null,
    actor_id: "u1",
    action: "invitation.created",
    target_type: "invitation",
    target_id: "i1",
    metadata: { role: "admin" },
    created_at: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "a2",
    tenant_id: "t1",
    actor_id: "u2",
    action: "invitation.revoked",
    target_type: "invitation",
    target_id: "i2",
    metadata: {},
    created_at: "2026-11-02T10:00:00.000Z",
  },
  {
    id: "a3",
    tenant_id: "t1",
    actor_id: "u1",
    action: "invitation.created",
    target_type: "invitation",
    target_id: "i3",
    metadata: {},
    created_at: "2026-11-03T10:00:00.000Z",
  },
];

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockReturnValue({
    select: () => ({
      order: async () => ({ data: ROWS, error: null }),
    }),
  });
});

afterEach(() => {
  cleanup();
});

describe("auditLogRowSchema", () => {
  it("valida shape", () => {
    expect(() => auditLogRowSchema.parse(ROWS[0])).not.toThrow();
  });
});

describe("filterAuditLog", () => {
  it("filtra por ação", () => {
    const out = filterAuditLog(ROWS as any, { action: "invitation.created" });
    expect(out).toHaveLength(2);
  });

  it("filtra por ator", () => {
    const out = filterAuditLog(ROWS as any, { actor: "u2" });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a2");
  });

  it("filtra por ator via actorId", () => {
    const out = filterAuditLog(ROWS as any, { actorId: "u1" });
    expect(out).toHaveLength(2);
  });

  it("filtra por período (from/to)", () => {
    const out = filterAuditLog(ROWS as any, {
      from: "2026-11-02T00:00:00.000Z",
      to: "2026-11-02T23:59:59.000Z",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a2");
  });

  it("todos retorna todos", () => {
    expect(filterAuditLog(ROWS as any, { action: "todos", actor: "todos" })).toHaveLength(3);
    expect(filterAuditLogs(ROWS as any)).toHaveLength(3);
  });

  it("suporta period array", () => {
    const out = filterAuditLog(ROWS as any, {
      period: ["2026-11-03T00:00:00.000Z", "2026-11-03T23:59:59.000Z"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a3");
  });
});

describe("useAuditLog", () => {
  it("busca audit_log e aplica filtro client-side", async () => {
    const { result } = renderWithClient(() =>
      useAuditLog({ action: "invitation.created" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("audit_log");
    expect(result.current.data).toHaveLength(2);
  });

  it("sem filtro retorna todos", async () => {
    const { result } = renderWithClient(() => useAuditLog());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
  });

  it("expõe isError em falha", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        order: async () => ({ data: null, error: { message: "rls" } }),
      }),
    });

    const { result } = renderWithClient(() => useAuditLog());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
