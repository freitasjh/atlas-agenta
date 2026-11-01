// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INVITATIONS_KEY,
  useInvitations,
  useInviteMember,
  useRevokeInvitation,
  useResendInvitation,
  invitationRowSchema,
} from "@/hooks/useInvitations";

const { fromMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    functions: { invoke: invokeMock },
  },
}));

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return { result, queryClient };
}

const ROW = {
  id: "inv-1",
  tenant_id: "t-1",
  email: "a@b.com",
  role: "professional",
  status: "pending",
  expires_at: "2026-12-01T00:00:00.000Z",
  accepted_at: null,
  accepted_user_id: null,
  created_by: "u-1",
  created_at: "2026-11-01T00:00:00.000Z",
};

beforeEach(() => {
  fromMock.mockReset();
  invokeMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useInvitations", () => {
  it("lê invitations sob RLS e valida com zod", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        order: async () => ({ data: [ROW], error: null }),
      }),
    });

    const { result } = renderWithClient(() => useInvitations());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("invitations");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe("inv-1");
    // schema exportado e válido
    expect(() => invitationRowSchema.parse(ROW)).not.toThrow();
  });

  it("lança em erro do PostgREST", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        order: async () => ({ data: null, error: { message: "rls" } }),
      }),
    });

    const { result } = renderWithClient(() => useInvitations());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useInviteMember", () => {
  it("invoca invite-member com {email, role} e invalida cache", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, invitation_id: "inv-2", expires_at: "2026-12-02T00:00:00.000Z" },
      error: null,
    });

    const { result, queryClient } = renderWithClient(() => useInviteMember());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ email: "x@y.com", role: "admin" });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("invite-member");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { email: "x@y.com", role: "admin" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: INVITATIONS_KEY }),
    );
  });

  it("propaga erro do invoke", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "forbidden" } });

    const { result } = renderWithClient(() => useInviteMember());
    await expect(
      result.current.mutateAsync({ email: "x@y.com", role: "admin" }),
    ).rejects.toBeTruthy();
  });
});

describe("useRevokeInvitation", () => {
  it("invoca revoke-invitation com invitation_id e invalida cache", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    const { result, queryClient } = renderWithClient(() => useRevokeInvitation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ invitation_id: "inv-1" });
    });

    expect(invokeMock.mock.calls[0]?.[0]).toBe("revoke-invitation");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { invitation_id: "inv-1" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: INVITATIONS_KEY }),
    );
  });

  it("aceita invitationId camelCase", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    const { result } = renderWithClient(() => useRevokeInvitation());
    await act(async () => {
      await result.current.mutateAsync({ invitationId: "inv-9" });
    });

    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { invitation_id: "inv-9" },
    });
  });
});

describe("useResendInvitation", () => {
  it("invoca resend-invitation com invitation_id e invalida cache", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, expires_at: "2026-12-03T00:00:00.000Z" },
      error: null,
    });

    const { result, queryClient } = renderWithClient(() => useResendInvitation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync("inv-3");
    });

    expect(invokeMock.mock.calls[0]?.[0]).toBe("resend-invitation");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { invitation_id: "inv-3" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: INVITATIONS_KEY }),
    );
  });
});
