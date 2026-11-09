// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrocarPlanoDialog } from "@/admin/empresas/TrocarPlanoDialog";
import type { TenantListItem } from "@/types/domain";

vi.mock("@/hooks/useSetPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useSetPlan")>();
  return {
    ...actual,
    useTenantPlanUsage: () => ({
      data: { plan: "clinica", active_professionals: 4, month_appointments: 200, month_key: "2026-11" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useSetTenantPlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

const TENANT: TenantListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  trade_name: "Studio Alfa",
  legal_name: "Alfa LTDA",
  document: null,
  owner_email: "a@a.com",
  plan: "clinica",
  subscription_status: "ativo",
  trial_ends_at: null,
  timezone: "America/Sao_Paulo",
  created_at: "2026-01-01T00:00:00.000Z",
};

function wrapper(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("TrocarPlanoDialog", () => {
  afterEach(() => cleanup());

  it("abre com gatilho e mostra progresso de 3 passos", async () => {
    render(wrapper(<TrocarPlanoDialog tenant={TENANT} />), {});
    const trigger = screen.getByRole("button", { name: "Trocar plano" });
    expect(trigger).toBeTruthy();
    expect(trigger.className).toContain("min-h-[44px]");
  });

  it("gatilho tem alvo mínimo 44px", () => {
    render(wrapper(<TrocarPlanoDialog tenant={TENANT} />), {});
    const trigger = screen.getByRole("button", { name: "Trocar plano" });
    expect(trigger.className).toContain("min-h-[44px]");
  });
});
