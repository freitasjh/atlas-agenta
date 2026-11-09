// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useInvitations", () => ({
  useInvitations: () => ({
    data: [
      {
        id: "inv-1",
        tenant_id: null,
        email: "sa@plataforma.com",
        role: "super_admin",
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

import { ConvitesPage } from "@/internal-admin/convites/ConvitesPage";

afterEach(() => cleanup());

describe("ConvitesPage", () => {
  it("renderiza lista e cópia em pt-BR", () => {
    render(<ConvitesPage />);
    expect(screen.getByText("Convites de super admin")).toBeTruthy();
    expect(screen.getAllByText("sa@plataforma.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Convidar super admin")).toBeTruthy();
  });
});
