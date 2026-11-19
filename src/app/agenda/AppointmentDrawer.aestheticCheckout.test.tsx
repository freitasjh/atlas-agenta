// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentDrawer } from "@/app/agenda/AppointmentDrawer";
import type { AppointmentWithRelations } from "@/types/domain";

/**
 * ADR-07 — Drawer da clínica: com `payments:false` + `aestheticCheckout:true`
 * a aba Pagamento abre o fechamento existente; sem a flag, mantém o
 * estado-guia + CTA. Nenhum componente financeiro novo.
 */

const mocks = vi.hoisted(() => ({
  role: "admin",
  payments: false as boolean | null,
  aesthetic: null as boolean | null,
  canRegisterPayments: true,
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

const C_ID = "11111111-1111-4111-8111-111111111111";
const P_ID = "22222222-2222-4222-8222-222222222222";
const S_ID = "33333333-3333-4333-8333-333333333333";
const AP_ID = "44444444-4444-4444-8444-444444444444";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({
    data: [{ id: C_ID, name: "Ana" }],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({
    data: [{ id: P_ID, name: "Bia" }],
    isLoading: false,
  }),
  useScheduleValidity: () => ({ data: null }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({
    data: [{ id: S_ID, name: "Limpeza de pele", duration_minutes: 60, price_cents: 12000 }],
    isLoading: false,
  }),
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
  useCreateAppointment: () => ({
    mutateAsync: mocks.createMutate,
    isPending: false,
  }),
  useUpdateAppointment: () => ({
    mutateAsync: mocks.updateMutate,
    isPending: false,
  }),
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
    canRegisterPayments: mocks.canRegisterPayments,
    canViewFinancials: mocks.role !== "receptionist",
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
    mocks.aesthetic === null
      ? null
      : {
          prontuario: false,
          pacotes: false,
          aestheticCheckout: mocks.aesthetic,
          estoque: false,
          comissaoProduto: false,
        },
}));
vi.mock("@/app/agenda/prontuario/ProntuarioTab", () => ({
  ProntuarioTab: () => null,
}));
vi.mock("@/app/agenda/pagamentos/AppointmentSettlementDialog", () => ({
  AppointmentSettlementDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="drawer-settlement-dialog" /> : null,
}));

afterEach(cleanup);
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  window.localStorage.clear();
  mocks.role = "admin";
  mocks.payments = false;
  mocks.aesthetic = null;
  mocks.canRegisterPayments = true;
  mocks.createMutate.mockReset().mockResolvedValue({});
  mocks.updateMutate.mockReset().mockResolvedValue({});
});

function editingAppointment(): AppointmentWithRelations {
  return {
    id: AP_ID,
    customer_id: C_ID,
    professional_id: P_ID,
    service_id: S_ID,
    combo_id: null,
    package_credit_id: null,
    starts_at: "2026-11-10T12:30:00.000Z",
    ends_at: "2026-11-10T13:30:00.000Z",
    price_cents: 12000,
    status: "confirmado",
    confirmed_at: "2026-11-09T10:00:00.000Z",
    confirmed_via: "operador",
    created_at: "2026-11-01T10:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: true },
    services: { name: "Limpeza de pele" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
  } as unknown as AppointmentWithRelations;
}

function renderDrawer() {
  render(
    <MemoryRouter>
      <AppointmentDrawer
        open
        onOpenChange={vi.fn()}
        appointment={editingAppointment()}
        day="2026-11-10"
        timeZone="America/Sao_Paulo"
        lockedProfessionalId={null}
        dayAppointments={[]}
        prefill={null}
      />
    </MemoryRouter>,
  );
}

function selectTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

describe("AppointmentDrawer — checkout clínica (ADR-07)", () => {
  it("clínica + aesthetic:true mostra 'Abrir fechamento' e abre o settlement", () => {
    mocks.payments = false;
    mocks.aesthetic = true;
    renderDrawer();
    selectTab("Pagamento");
    fireEvent.click(screen.getByRole("button", { name: "Abrir fechamento" }));
    expect(screen.getByTestId("drawer-settlement-dialog")).toBeTruthy();
  });

  it("clínica + aesthetic:false mantém estado-guia + CTA", () => {
    mocks.payments = false;
    mocks.aesthetic = false;
    renderDrawer();
    selectTab("Pagamento");
    expect(screen.getByText(/Fechamento indisponível/)).toBeDefined();
    expect(screen.getByRole("link", { name: /Ver plano/ })).toBeDefined();
  });

  it("clínica + entitlement null mantém estado-guia sem crash", () => {
    mocks.payments = false;
    mocks.aesthetic = null;
    renderDrawer();
    selectTab("Pagamento");
    expect(screen.getByText(/Fechamento indisponível/)).toBeDefined();
  });

  it("salão (payments:true) inalterado mesmo sem entitlement", () => {
    mocks.payments = true;
    mocks.aesthetic = null;
    renderDrawer();
    selectTab("Pagamento");
    fireEvent.click(screen.getByRole("button", { name: "Abrir fechamento" }));
    expect(screen.getByTestId("drawer-settlement-dialog")).toBeTruthy();
  });
});
