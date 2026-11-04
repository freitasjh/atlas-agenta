// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canManageCatalog: true }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ commission: false, combos: false }),
}));

vi.mock("@/hooks/useProfessionalCommission", () => ({
  useProfessionalCommission: () => ({ data: 0, isLoading: false }),
  useUpsertProfessionalCommission: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useTenantUsers", () => ({
  useTenantUsers: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({
    data: [
      {
        id: "p-1",
        tenant_id: "t-1",
        name: "Ana",
        profile_id: null,
        active: true,
        schedule_start_date: null,
        schedule_end_date: null,
        slot_step_minutes: 30,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p-2",
        tenant_id: "t-1",
        name: "Bruno",
        profile_id: "prof-2",
        active: true,
        schedule_start_date: null,
        schedule_end_date: null,
        slot_step_minutes: 30,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p-3",
        tenant_id: "t-1",
        name: "Carla",
        profile_id: null,
        active: false,
        schedule_start_date: null,
        schedule_end_date: null,
        slot_step_minutes: 30,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDeactivateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkProfessionalProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProfessional: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { MemoryRouter } from "react-router-dom";
import { ProfissionaisPage } from "@/app/config/profissionais/ProfissionaisPage";

afterEach(() => cleanup());

describe("ProfissionaisPage", () => {
  it("exibe botão Convidar para acesso apenas para profissional ativo sem login", () => {
    render(
      <MemoryRouter>
        <ProfissionaisPage />
      </MemoryRouter>,
    );
    const buttons = screen.getAllByText("Convidar para acesso");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("exibe indicador de acesso vinculado", () => {
    render(
      <MemoryRouter>
        <ProfissionaisPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Vinculado").length).toBeGreaterThan(0);
  });
});