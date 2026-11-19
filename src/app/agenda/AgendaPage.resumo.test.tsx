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

const mocks = vi.hoisted(() => ({
  role: "admin",
  appointments: [] as unknown[],
}));

vi.mock("@/hooks/useAppointments", () => ({
  mapSchedulingError: (error: unknown) => String(error),
  useAppointments: ({ status }: { status?: string } = {}) => ({
    data: status
      ? (mocks.appointments as { status: string }[]).filter((a) => a.status === status)
      : mocks.appointments,
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
  useChangeAppointmentStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useSegmentFeatures: () => ({ commission: false, payments: false }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canManageAppointments: true,
    canScheduleForAnyProfessional: true,
    canSendWhatsAppMessage: false,
    canViewCommission: false,
    canViewFinancials: false,
    canRegisterPayments: false,
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    role: mocks.role,
    tenant: { timezone: "America/Sao_Paulo" },
    userId: "u-1",
  }),
}));
vi.mock("@/hooks/useAgendaPaymentFlags", () => ({
  useAgendaPaymentFlags: () => ({
    statusById: new Map(),
    pendingCount: 0,
    isLoading: false,
    isError: false,
  }),
}));
// ADR-07: fiação nova da AgendaPage (badge + régua no confirmar).
vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => null,
}));
vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    <button type="button" disabled={disabled} onClick={() => onSelect?.()} {...rest}>
      {children}
    </button>
  ),
}));
vi.mock("@/app/agenda/StatusChangeConfirm", () => ({
  StatusChangeConfirm: () => null,
}));
vi.mock("@/app/whatsapp/SendMessageDialog", () => ({
  SendMessageDialog: () => null,
}));
vi.mock("@/app/agenda/AppointmentFormDialog", () => ({
  AppointmentFormDialog: () => null,
}));

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "ap-1",
    customer_id: "c-1",
    professional_id: "pr-1",
    service_id: "s-1",
    combo_id: null,
    starts_at: "2026-11-10T12:00:00.000-03:00",
    ends_at: "2026-11-10T13:00:00.000-03:00",
    price_cents: 10000,
    status: "pendente",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-10T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: true },
    services: { name: "Corte" },
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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  mocks.role = "admin";
  mocks.appointments = [
    appointment(),
    appointment({
      id: "ap-2",
      status: "confirmado",
      customers: { name: "Carla", whatsapp_opt_in: true },
    }),
  ];
});

afterEach(cleanup);

describe("AgendaPage — ResumoDoDia + filtros (ADR-02)", () => {
  it("renderiza o resumo com Previsto em R$ para admin", () => {
    renderPage();
    expect(screen.getByTestId("resumo-do-dia")).toBeTruthy();
    expect(screen.getByText("R$ 200,00")).toBeTruthy();
    expect(screen.getByText("2 agendados")).toBeTruthy();
  });

  it("clique em 'A confirmar' filtra status=pendente (só Ana na lista)", () => {
    renderPage();
    expect(screen.getByText("Carla")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^A confirmar: / }));
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Carla")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remover filtro Pendente" }),
    ).toBeTruthy();
  });

  it("receptionist: resumo sem nenhum 'R$' (valor vira '—')", () => {
    mocks.role = "receptionist";
    renderPage();
    const resumo = screen.getByTestId("resumo-do-dia");
    expect(resumo.textContent).not.toMatch(/R\$/);
    expect(resumo.textContent).toContain("—");
  });

  it("quick filters Hoje/Amanhã/Esta semana + chips 'Limpar tudo' zeram filtros", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "A confirmar" }));
    expect(screen.getByTestId("agenda-filter-chips")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Limpar tudo/ }));
    expect(screen.queryByTestId("agenda-filter-chips")).toBeNull();
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("'Filtros' abre os avançados com profissional, serviço e status", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText(/Profissionais/)).toBeTruthy();
    expect(screen.getByLabelText(/Serviços/)).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();
  });

  it("com filtro 'A confirmar' ativo, KPIs refletem o dia cheio (base não-filtrada)", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^A confirmar: / }));
    // Lista filtra (só Ana visível).
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Carla")).toBeNull();
    // KPIs mantêm a base cheia do dia (2 agendados, R$ 200).
    expect(screen.getByText("R$ 200,00")).toBeTruthy();
    expect(screen.getByText("2 agendados")).toBeTruthy();
  });
});
