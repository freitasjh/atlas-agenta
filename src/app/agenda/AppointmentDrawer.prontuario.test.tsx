// @vitest-environment happy-dom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentDrawer } from "@/app/agenda/AppointmentDrawer";
import type { AppointmentWithRelations } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  role: "admin",
  payments: false as boolean | null,
  prontuario: null as boolean | null,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: [], isLoading: false }),
  useScheduleValidity: () => ({ data: null }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useCombos", () => ({
  useCombos: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useComboServices", () => ({
  useComboServices: () => ({ data: [] }),
}));
vi.mock("@/hooks/useWorkingHours", () => ({
  useWorkingHours: () => ({ data: [] }),
}));
vi.mock("@/hooks/useScheduleOverrides", () => ({
  useScheduleOverrides: () => ({ data: [] }),
}));
vi.mock("@/hooks/useAvailableSlots", () => ({
  useAvailableSlots: () => ({ slots: [], isLoading: false, isEnabled: false }),
}));
vi.mock("@/hooks/useAppointments", () => ({
  mapSchedulingError: (e: unknown) => String(e),
  useCreateAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({
    commission: false,
    combos: false,
    payments: mocks.payments,
  }),
}));
vi.mock("@/hooks/useSegmentTerms", () => ({
  useSegmentTerms: () => ({
    servicoLabelSingular: "Serviço",
    profissionalLabelSingular: "Profissional",
    clienteLabel: "Cliente",
    servicosLabel: "Serviços",
  }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canEditAnySchedule: true,
    canEditOwnSchedule: true,
    canRegisterPayments: true,
    canViewFinancials: false,
    canViewCommission: false,
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    role: mocks.role,
    tenantId: "t-1",
    tenant: { timezone: "America/Sao_Paulo" },
    userId: "u-1",
    isLoadingAuth: false,
    hasTenantError: false,
  }),
}));
vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () =>
    mocks.prontuario === null
      ? null
      : {
          prontuario: mocks.prontuario,
          pacotes: false,
          aestheticCheckout: false,
          estoque: false,
          comissaoProduto: false,
        },
}));
vi.mock("@/app/agenda/prontuario/ProntuarioTab", () => ({
  ProntuarioTab: (props: { active: boolean }) => (
    <div data-testid="prontuario-stub" data-active={String(props.active)}>
      stub
    </div>
  ),
}));

const AP_ID = "44444444-4444-4444-8444-444444444444";
const C_ID = "11111111-1111-4111-8111-111111111111";
const P_ID = "22222222-2222-4222-8222-222222222222";
const S_ID = "33333333-3333-4333-8333-333333333333";

function baseAppointment(): AppointmentWithRelations {
  return {
    id: AP_ID,
    tenant_id: "t-1",
    customer_id: C_ID,
    professional_id: P_ID,
    service_id: S_ID,
    combo_id: null,
    starts_at: "2026-11-10T12:00:00.000Z",
    ends_at: "2026-11-10T13:00:00.000Z",
    duration_minutes: 60,
    price_cents: 8000,
    status: "confirmado",
    created_at: "2026-11-01T12:00:00.000Z",
    confirmed_at: null,
    customers: null,
    professionals: null,
    services: null,
    combos: null,
  } as unknown as AppointmentWithRelations;
}

function selectTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  // Radix Tabs seleciona no mousedown/focus (click sozinho não troca).
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  return tab;
}
function renderDrawer() {
  function Wrapper() {
    const [open, setOpen] = useState(true);
    return (
      <MemoryRouter>
        <AppointmentDrawer
          open={open}
          onOpenChange={setOpen}
          appointment={baseAppointment()}
          day="2026-11-10"
          timeZone="America/Sao_Paulo"
          lockedProfessionalId={null}
          dayAppointments={[]}
        />
      </MemoryRouter>
    );
  }
  return render(<Wrapper />);
}

afterEach(cleanup);
beforeEach(() => {
  mocks.role = "admin";
  mocks.prontuario = null;
});

describe("AppointmentDrawer — aba Prontuário (B1/B3 + gating)", () => {
  it("renderiza 4 abas em linha única com scroll (B1)", () => {
    renderDrawer();
    const list = screen.getByRole("tablist");
    expect(list.className).toMatch(/overflow-x-auto/);
    expect(list.className).not.toMatch(/grid-cols-3/);
    expect(screen.getByRole("tab", { name: "Prontuário" })).toBeTruthy();
  });

  it("sem entitlement: aba habilitada com título explicativo e upsell alcançável", async () => {
    mocks.prontuario = false;
    renderDrawer();
    const tab = screen.getByRole("tab", { name: "Prontuário" });
    expect((tab as HTMLButtonElement).disabled).toBe(false);
    expect(tab.getAttribute("title")).toBe(
      "Prontuário não incluído no plano atual",
    );
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => {
      expect(tab.getAttribute("aria-selected")).toBe("true");
    });
    const stub = screen.getByTestId("prontuario-stub");
    expect(stub.getAttribute("data-active")).toBe("true");
  });

  it("entitlements nulo: título de verificação antes de saber", () => {
    renderDrawer();
    const tab = screen.getByRole("tab", { name: "Prontuário" });
    expect((tab as HTMLButtonElement).disabled).toBe(false);
    expect(tab.getAttribute("title")).toBe("Verificando plano…");
  });

  it("com entitlement: aba habilitada e painel selecionável", async () => {
    mocks.prontuario = true;
    renderDrawer();
    const tab = screen.getByRole("tab", { name: "Prontuário" });
    expect((tab as HTMLButtonElement).disabled).toBe(false);
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() => {
      expect(tab.getAttribute("aria-selected")).toBe("true");
    });
    const stub = screen.getByTestId("prontuario-stub");
    expect(stub.getAttribute("data-active")).toBe("true");
  });

  it("painéis inativos têm hidden; ativo tem underline além da cor (B3)", async () => {
    mocks.prontuario = true;
    renderDrawer();
    const panels = document.querySelectorAll('[role="tabpanel"]');
    expect(panels.length).toBe(4);
    const hidden = Array.from(panels).filter((panel) =>
      panel.hasAttribute("hidden"),
    );
    expect(hidden.length).toBe(3);
    const tab = selectTab("Prontuário");
    await waitFor(() => {
      expect(tab.getAttribute("aria-selected")).toBe("true");
    });
    expect(tab.className).toMatch(/underline/);
  });
});
