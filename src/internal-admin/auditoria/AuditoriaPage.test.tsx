// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuditLog", () => ({
  useAuditLog: () => ({
    data: [
      {
        id: "a1",
        tenant_id: null,
        actor_id: "u1",
        action: "invitation.created",
        target_type: "invitation",
        target_id: "i1",
        metadata: {},
        created_at: "2026-11-01T10:00:00.000Z",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { AuditoriaPage } from "@/internal-admin/auditoria/AuditoriaPage";

afterEach(() => cleanup());

describe("AuditoriaPage", () => {
  it("renderiza lista e cópia em pt-BR", () => {
    render(<AuditoriaPage />);
    expect(screen.getByText("Auditoria")).toBeTruthy();
    expect(screen.getAllByText("invitation.created").length).toBeGreaterThan(0);
  });
});
