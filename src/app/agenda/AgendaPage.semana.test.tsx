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
  dayAppointments: [] as unknown[],
  weekFull: [] as unknown[],
  weekFiltered: [] as unknown[],
  whIds: [] as string[],
  whRows: [] as unknown[],
}));

vi.mock("@/hooks/useAppointments", () => ({
  mapSchedulingError: (error: unknown) => String(error),
  useAppointments: ({ status }: { status?: string } = {}) => ({
    data: status
      ? (mocks.dayAppointments as { status: string }[]).filter(
          (a) => a.status === status,
        )
      : mocks.dayAppointments,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAppointmentsRange: ({
    serviceId,
    status,
  }: { serviceId?: string; status?: string } = {}) => ({
    data: serviceId || status ? mocks.weekFiltered : mocks.weekFull,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useChangeAppointmentStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({
    data: [
      { id: "pr-1", name: "Bia" },
      { id: "pr-2", name: "Cris" },
    ],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({
    data: [
      { id: "s-1", name: "Corte" },
      { id: "s-2", name: "Barba" },
    ],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useResources", () => ({
  useResources: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useWorkingHours", () => ({
  useWorkingHours: () => ({ data: [] }),
  useWorkingHoursMany: (ids: string[]) => {
    mocks.whIds = [...ids];
    return { data: mocks.whRows, isLoading: false, isError: false };
  },
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
    starts_at: "2026-11-10T12:00:00.000Z",
    ends_at: "2026-11-10T13:00:00.000Z",
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

function renderSemana() {
  render(
    <MemoryRouter initialEntries={["/app/agenda?dia=2026-11-10"]}>
      <AgendaPage />
    </MemoryRouter>,
  );
}

function occupancyHeaders() {
  return screen.getAllByTestId("week-day-occupancy-2026-11-10");
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      // Visão Semana persistida (a página lê no primeiro render).
      getItem: (key: string) =>
        key === "atlas:agenda-view" ? "semana" : null,
      setItem: () => undefined,
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
  mocks.role = "admin";
  const ap1 = appointment({});
  const ap2 = appointment({
    id: "ap-2",
    professional_id: "pr-2",
    service_id: "s-2",
    status: "confirmado",
    starts_at: "2026-11-10T14:00:00.000Z",
    ends_at: "2026-11-10T15:00:00.000Z",
    customers: { name: "Carla", whatsapp_opt_in: true },
    services: { name: "Barba" },
    professionals: { name: "Cris" },
  });
  mocks.dayAppointments = [ap1, ap2];
  mocks.weekFull = [ap1, ap2];
  mocks.weekFiltered = [ap1];
  mocks.whIds = [];
  // Grade real dos dois profissionais na terça (weekday 2): 08–18 → 20 slots
  // cada, 40 no total. Sem agregado, "todos" cairia no estimado.
  mocks.whRows = [
    {
      id: "wh-1",
      tenant_id: "t-1",
      professional_id: "pr-1",
      weekday: 2,
      start_time: "08:00",
      end_time: "18:00",
      break_start: null,
      break_end: null,
      created_at: "2026-11-01T00:00:00.000Z",
    },
    {
      id: "wh-2",
      tenant_id: "t-1",
      professional_id: "pr-2",
      weekday: 2,
      start_time: "08:00",
      end_time: "18:00",
      break_start: null,
      break_end: null,
      created_at: "2026-11-01T00:00:00.000Z",
    },
  ];
});

afterEach(cleanup);

describe("AgendaPage — Semana ADR-05 (correções review)", () => {
  it("todos-com-grades: busca as grades da lista visível (sem estimado)", () => {
    renderSemana();
    // O hook agregado recebe os dois ids visíveis, não só um.
    expect(mocks.whIds).toContain("pr-1");
    expect(mocks.whIds).toContain("pr-2");
    // 2 ocupados / 40 slots reais → 5%, sem apoio "estimado".
    const headers = occupancyHeaders();
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.textContent).toContain("2 de 40");
      expect(header.textContent).not.toContain("estimado");
    }
  });

  it("filtro-ativo-mantém-%: recorte filtra a lista, não a ocupação", () => {
    renderSemana();
    fireEvent.click(screen.getByRole("button", { name: "A confirmar" }));
    // Lista (lanes) filtra: só Ana visível (mobile + desktop rendem 2 lanes).
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Carla")).toHaveLength(0);
    // Ocupação segue sobre a base cheia do intervalo: 2 de 40, sem estimado.
    const headers = occupancyHeaders();
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.textContent).toContain("2 de 40");
      expect(header.textContent).toContain("5%");
      expect(header.textContent).not.toContain("estimado");
    }
  });
});
