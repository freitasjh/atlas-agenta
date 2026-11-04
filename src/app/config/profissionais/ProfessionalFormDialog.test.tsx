// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProfessionals", () => ({
  useCreateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpsertProfessionalCommission: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkProfessionalProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useProfessionalCommission", () => ({
  useProfessionalCommission: () => ({ data: 0, isLoading: false }),
  useUpsertProfessionalCommission: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ commission: false, combos: false }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canManageCommission: false, isAdmin: true }),
}));

vi.mock("@/hooks/useTenantUsers", () => ({
  useTenantUsers: () => ({
    data: [
      {
        id: "profile-1",
        tenant_id: "t-1",
        role: "professional",
        full_name: "Ana",
        email: "ana@empresa.com",
        active: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { ProfessionalFormDialog } from "@/app/config/profissionais/ProfessionalFormDialog";

afterEach(() => cleanup());

describe("ProfessionalFormDialog", () => {
  it("exibe acesso vinculado com e-mail quando profile_id presente", () => {
    render(
      <ProfessionalFormDialog
        open={true}
        onOpenChange={() => {}}
        professional={{
          id: "p-1",
          tenant_id: "t-1",
          name: "Ana",
          profile_id: "profile-1",
          active: true,
          schedule_start_date: null,
          schedule_end_date: null,
          slot_step_minutes: 30,
          created_at: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("Acesso vinculado a: ana@empresa.com")).toBeTruthy();
    expect(screen.getByText("Revogar acesso")).toBeTruthy();
  });

  it("exibe sem login vinculado quando profile_id ausente", () => {
    render(
      <ProfessionalFormDialog
        open={true}
        onOpenChange={() => {}}
        professional={{
          id: "p-2",
          tenant_id: "t-1",
          name: "Bruno",
          profile_id: null,
          active: true,
          schedule_start_date: null,
          schedule_end_date: null,
          slot_step_minutes: 30,
          created_at: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("Sem login vinculado.")).toBeTruthy();
  });
});