// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentDrawer } from "@/app/agenda/AppointmentDrawer";
import type { AppointmentWithRelations } from "@/types/domain";
import type { DepositCharge } from "@/lib/validations/deposit";

const mocks = vi.hoisted(() => ({
  canSendWhatsAppMessage: true,
  canCancelCharge: true,
}));

const C_ID = "11111111-1111-4111-8111-111111111111";
const P_ID = "22222222-2222-4222-8222-222222222222";
const S_ID = "33333333-3333-4333-8333-333333333333";
const AP_ID = "44444444-4444-4444-8444-444444444444";

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
  useSegmentFeatures: () => ({ combos: false, payments: false }),
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
    canViewFinancials: true,
    canViewCommission: false,
    canSendWhatsAppMessage: mocks.canSendWhatsAppMessage,
    canCancelCharge: mocks.canCancelCharge,
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    role: "admin",
    tenantId: "t-1",
    tenant: { timezone: "America/Sao_Paulo" },
    userId: "u-1",
    isLoadingAuth: false,
    hasTenantError: false,
  }),
}));
vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => null,
}));
vi.mock("@/app/agenda/prontuario/ProntuarioTab", () => ({
  ProntuarioTab: () => null,
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.canSendWhatsAppMessage = true;
  mocks.canCancelCharge = true;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

function depositAppointment(): AppointmentWithRelations {
  return {
    id: AP_ID,
    customer_id: C_ID,
    professional_id: P_ID,
    service_id: S_ID,
    combo_id: null,
    starts_at: "2026-11-10T12:30:00.000Z",
    ends_at: "2026-11-10T13:30:00.000Z",
    price_cents: 10000,
    status: "aguardando_deposito",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-01T10:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: true },
    services: { name: "Corte" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
  } as unknown as AppointmentWithRelations;
}

const CHARGE: DepositCharge = {
  id: "charge-1",
  status: "pendente",
  amountCents: 3000,
  pixQrCode: null,
  pixCopiaECola: "pix-teste",
  expiresAt: null,
};

function renderDrawer(props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <AppointmentDrawer
        open
        onOpenChange={vi.fn()}
        appointment={depositAppointment()}
        day="2026-11-10"
        timeZone="America/Sao_Paulo"
        lockedProfessionalId={null}
        dayAppointments={[]}
        depositCharge={CHARGE}
        onResendDepositQr={vi.fn()}
        onCancelDepositCharge={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

function selectTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

describe("AppointmentDrawer — depósito (ADR-12 / RF-06)", () => {
  it("badge 'Aguardando depósito' aparece na aba Histórico", () => {
    renderDrawer();
    selectTab("Histórico");
    expect(
      screen.getByRole("status", { name: /aguardando depósito/i }),
    ).toBeDefined();
    // StatusBadge ("Aguardando depósito") + DepositBadge dedicado.
    expect(screen.getAllByText("Aguardando depósito").length).toBeGreaterThanOrEqual(2);
  });

  it("aba Pagamento exibe a charge com ações (RBAC liberado)", () => {
    renderDrawer();
    selectTab("Pagamento");
    expect(screen.getByText(/depósito\/sinal/i)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /reenviar qr/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /cancelar cobrança/i }),
    ).toBeDefined();
  });

  it("sem RBAC: painel some as ações, mantém leitura", () => {
    mocks.canSendWhatsAppMessage = false;
    mocks.canCancelCharge = false;
    renderDrawer();
    selectTab("Pagamento");
    expect(screen.getByText(/depósito\/sinal/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /reenviar qr/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /cancelar cobrança/i }),
    ).toBeNull();
  });

  it("sem charge: mostra dica em vez do painel", () => {
    renderDrawer({ depositCharge: null });
    selectTab("Pagamento");
    expect(screen.getByText(/cobrança pix aparece aqui/i)).toBeDefined();
  });
});
