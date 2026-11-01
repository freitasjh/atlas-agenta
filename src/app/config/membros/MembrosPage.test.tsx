// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: true }),
}));

vi.mock("@/hooks/useInvitations", () => ({
  useInvitations: () => ({
    data: [
      {
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
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useInviteMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResendInvitation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeInvitation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { MembrosPage } from "@/app/config/membros/MembrosPage";

afterEach(() => cleanup());

describe("MembrosPage", () => {
  it("renderiza lista e cópia em pt-BR", () => {
    render(<MembrosPage />);
    expect(screen.getByText("Membros")).toBeTruthy();
    expect(screen.getAllByText("a@b.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Convidar membro")).toBeTruthy();
    expect(screen.getAllByText("Pendente").length).toBeGreaterThan(0);
  });
});
