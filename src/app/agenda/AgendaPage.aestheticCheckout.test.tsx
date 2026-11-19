// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgendaPage } from "@/app/agenda/AgendaPage";

// ADR-12: fiação do depósito (charge real via Edge). Sem provider nestes
// testes, o hook é mockado (retorna nulo = drawer na dica).
vi.mock("@/hooks/useDepositCharge", () => ({
  useDepositCharge: () => ({ data: null, refetch: () => Promise.resolve({}) }),
}));

/**
 * ADR-07 — G5 Checkout clínica (flag aestheticCheckout, reuso Settlement/Capture).
 * Matriz segmento×flag: clínica (payments:false) + aestheticCheckout:true abre
 * checkout; false/null cai no legado sem crash; salão (payments:true) inalterado;
 * sessão de pacote (package_credit_id) pula a cobrança (sem dupla cobrança).
 */

const mocks = vi.hoisted(() => ({
  payments: false as boolean | null,
  aesthetic: null as boolean | null,
  validCredit: false as boolean,
  flags: {
    statusById: new Map<string, string>([["ap-1", "sem_pagamento"]]),
    pendingCount: 1,
    isLoading: false,
    isError: false,
  },
  changeStatus: vi.fn(),
  appointments: [] as unknown[],
}));

vi.mock("@/hooks/useValidPackageCredit", () => ({
  hasValidPackageCredit: () => Promise.resolve(mocks.validCredit),
}));

vi.mock("@/hooks/useAppointments", () => ({
  mapSchedulingError: (error: unknown) => String(error),
  useAppointments: () => ({
    data: mocks.appointments,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAppointmentsRange: () => ({
    data: mocks.appointments,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useChangeAppointmentStatus: () => ({
    mutateAsync: mocks.changeStatus,
    isPending: false,
  }),
  useUpdateAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useResources", () => ({
  useResources: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useWorkingHours", () => ({
  useWorkingHours: () => ({ data: [] }),
  useWorkingHoursMany: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useSegmentTerms", () => ({
  useSegmentTerms: () => ({
    servicosLabel: "Serviços",
    profissionaisLabel: "Profissionais",
  }),
}));
vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({
    commission: false,
    payments: mocks.payments,
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
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canManageAppointments: true,
    canScheduleForAnyProfessional: true,
    canSendWhatsAppMessage: false,
    canViewCommission: false,
    canViewFinancials: true,
    canRegisterPayments: true,
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: { timezone: "America/Sao_Paulo" },
    userId: "u-1",
    role: "admin",
  }),
}));
vi.mock("@/hooks/useAgendaPaymentFlags", () => ({
  useAgendaPaymentFlags: () => mocks.flags,
}));
vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    ...rest
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.()}
      {...rest}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/app/agenda/pagamentos/PaymentCaptureDialog", () => ({
  PaymentCaptureDialog: ({
    open,
    mode,
  }: {
    open: boolean;
    mode: string;
  }) => (open ? <div data-testid="capture-dialog">{mode}</div> : null),
}));
vi.mock("@/app/agenda/pagamentos/AppointmentSettlementDialog", () => ({
  AppointmentSettlementDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="settlement-dialog" /> : null,
}));
vi.mock("@/app/agenda/StatusChangeConfirm", () => ({
  StatusChangeConfirm: ({ change }: { change: unknown }) =>
    change ? <div data-testid="legacy-confirm" /> : null,
}));
vi.mock("@/app/whatsapp/SendMessageDialog", () => ({
  SendMessageDialog: () => null,
}));
vi.mock("@/app/agenda/AppointmentFormDialog", () => ({
  AppointmentFormDialog: () => null,
}));

const TENANT_TIMEZONE = "America/Sao_Paulo";

function todayNoonTenant(): { start: string; end: string } {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: TENANT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const start = `${localDate}T12:00:00.000-03:00`;
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  return { start, end };
}

function appointment(overrides: Record<string, unknown> = {}) {
  const { start, end } = todayNoonTenant();
  return {
    id: "ap-1",
    customer_id: "c-1",
    professional_id: "pr-1",
    service_id: "s-1",
    combo_id: null,
    package_credit_id: null,
    starts_at: start,
    ends_at: end,
    price_cents: 10000,
    status: "em_atendimento",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-01T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: false },
    services: { name: "Limpeza de pele" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <AgendaPage />
    </MemoryRouter>,
  );
}

function clickConclude() {
  const conclude = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes("Concluído"));
  expect(conclude).toBeTruthy();
  fireEvent.click(conclude as HTMLButtonElement);
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined },
  });
  mocks.payments = false;
  mocks.aesthetic = null;
  mocks.validCredit = false;
  mocks.changeStatus.mockReset();
  mocks.appointments = [appointment()];
  mocks.flags = {
    statusById: new Map<string, string>([["ap-1", "sem_pagamento"]]),
    pendingCount: 1,
    isLoading: false,
    isError: false,
  };
});

afterEach(cleanup);

describe("AgendaPage — checkout clínica (ADR-07)", () => {
  it("clínica + aestheticCheckout:true abre o capture ao concluir (não o legado)", async () => {
    mocks.payments = false;
    mocks.aesthetic = true;
    renderPage();
    clickConclude();
    expect(await screen.findByTestId("capture-dialog")).toBeTruthy();
    expect(screen.queryByTestId("legacy-confirm")).toBeNull();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("clínica + aestheticCheckout:false mantém o fluxo legado", () => {
    mocks.payments = false;
    mocks.aesthetic = false;
    renderPage();
    clickConclude();
    expect(screen.getByTestId("legacy-confirm")).toBeTruthy();
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("clínica + entitlement null degrada para o legado sem crash", () => {
    mocks.payments = false;
    mocks.aesthetic = null;
    renderPage();
    clickConclude();
    expect(screen.getByTestId("legacy-confirm")).toBeTruthy();
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("salão (payments:true) inalterado: capture com ou sem aesthetic", async () => {
    for (const aesthetic of [false, true, null] as const) {
      mocks.payments = true;
      mocks.aesthetic = aesthetic;
      renderPage();
      clickConclude();
      expect(await screen.findByTestId("capture-dialog")).toBeTruthy();
      expect(screen.queryByTestId("legacy-confirm")).toBeNull();
      cleanup();
    }
  });

  it("clínica + aesthetic:true mostra a ação Pagamento e abre o settlement", () => {
    mocks.payments = false;
    mocks.aesthetic = true;
    mocks.appointments = [appointment({ status: "concluido" })];
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir pagamento do atendimento/ }),
    );
    expect(screen.getByTestId("settlement-dialog")).toBeTruthy();
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
  });

  it("clínica + aesthetic:false não mostra a ação Pagamento", () => {
    mocks.payments = false;
    mocks.aesthetic = false;
    mocks.appointments = [appointment({ status: "concluido" })];
    renderPage();
    expect(
      screen.queryByRole("button", { name: /Abrir pagamento do atendimento/ }),
    ).toBeNull();
  });

  it("sessão de pacote conclui pelo legado (pula cobrança, sem dupla cobrança)", () => {
    mocks.payments = false;
    mocks.aesthetic = true;
    mocks.appointments = [appointment({ package_credit_id: "cr-1" })];
    renderPage();
    clickConclude();
    expect(screen.getByTestId("legacy-confirm")).toBeTruthy();
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("crédito válido sem vínculo prévio conclui pelo legado (auto-vínculo consome)", async () => {
    // O auto-vínculo do trigger grava o vínculo no concluir: pré-concluir é
    // sempre null na sessão do pacote — o SSoT do servidor decide, sem capture.
    mocks.payments = false;
    mocks.aesthetic = true;
    mocks.validCredit = true;
    mocks.appointments = [appointment({ package_credit_id: null })];
    renderPage();
    clickConclude();
    expect(await screen.findByTestId("legacy-confirm")).toBeTruthy();
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("payments null nunca cai no legado, mesmo com aesthetic:true", () => {
    mocks.payments = null;
    mocks.aesthetic = true;
    renderPage();
    const conclude = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("Carregando"));
    expect(conclude).toBeTruthy();
    fireEvent.click(conclude as HTMLButtonElement);
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
    expect(screen.queryByTestId("legacy-confirm")).toBeNull();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });
});
