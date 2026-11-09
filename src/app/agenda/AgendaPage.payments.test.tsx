// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgendaPage } from "@/app/agenda/AgendaPage";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

const mocks = vi.hoisted(() => ({
  payments: true as boolean | null,
  flags: {
    statusById: new Map<string, string>([
      ["ap-1", "sem_pagamento"],
      ["ap-2", "quitado"],
    ]),
    pendingCount: 1,
    isLoading: false,
    isError: false,
  },
  changeStatus: vi.fn(),
  appointments: [] as unknown[],
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
}));
vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useWorkingHours", () => ({
  useWorkingHours: () => ({ data: [] }),
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
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canManageAppointments: true,
    canScheduleForAnyProfessional: true,
    canSendWhatsAppMessage: true,
    canViewCommission: false,
    canViewFinancials: true,
    canRegisterPayments: true,
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" }, userId: "u-1" }),
}));
vi.mock("@/hooks/useAgendaPaymentFlags", () => ({
  useAgendaPaymentFlags: () => mocks.flags,
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
  }) =>
    open ? <div data-testid="capture-dialog">{mode}</div> : null,
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

/**
 * Hoje ao meio-dia no fuso do tenant, em ISO. Datas fixas (ex.: 2026-11-06) caem fora da
 * semana corrente e a visão Semana deixa de renderizar o card, quebrando o teste por
 * calendário — não por regressão. Derivar de "hoje" mantém a fixture sempre dentro da semana.
 */
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
    starts_at: start,
    ends_at: end,
    price_cents: 10000,
    status: "concluido",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-01T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: false },
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

function clickConclude(label = "Concluído") {
  const conclude = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes(label));
  expect(conclude).toBeTruthy();
  fireEvent.click(conclude as HTMLButtonElement);
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined },
  });
  mocks.payments = true;
  mocks.changeStatus.mockReset();
  mocks.appointments = [appointment(), appointment({ id: "ap-2", customers: { name: "Carla", whatsapp_opt_in: false } })];
  mocks.flags = {
    statusById: new Map<string, string>([
      ["ap-1", "sem_pagamento"],
      ["ap-2", "quitado"],
    ]),
    pendingCount: 1,
    isLoading: false,
    isError: false,
  };
});

afterEach(cleanup);

describe("AgendaPage — pagamento (ADR-004 §4.2/§7)", () => {
  it("payments === null bloqueia 'Concluir' com 'Carregando…' e não cai no legado", () => {
    mocks.payments = null;
    mocks.appointments = [appointment({ status: "em_atendimento" })];
    renderPage();
    clickConclude("Carregando…");
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
    expect(screen.queryByTestId("legacy-confirm")).toBeNull();
    expect(screen.getAllByText("Carregando…").length).toBeGreaterThan(0);
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("payments === true abre o capture e não chama changeStatus", () => {
    mocks.appointments = [appointment({ status: "em_atendimento" })];
    renderPage();
    clickConclude();
    expect(screen.getByTestId("capture-dialog").textContent).toBe("close");
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("payments === false mantém o fluxo legado", () => {
    mocks.payments = false;
    mocks.appointments = [appointment({ status: "em_atendimento" })];
    renderPage();
    clickConclude();
    expect(screen.getByTestId("legacy-confirm")).toBeTruthy();
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it("ação 'Pagamento' aparece e abre o settlement (sem abrir capture)", () => {
    renderPage();
    fireEvent.click(
      screen.getAllByRole("button", { name: /Abrir pagamento do atendimento/ })[0],
    );
    expect(screen.getByTestId("settlement-dialog")).toBeTruthy();
    expect(screen.queryByTestId("capture-dialog")).toBeNull();
  });

  it("toggle 'Pagamento pendente (N)' filtra a lista", () => {
    renderPage();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Carla")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.agenda.filterPendingAria }),
    );

    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Carla")).toBeNull();
    expect(
      screen.getByRole("button", { name: paymentsMessages.agenda.filterPendingAria })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("filtro 'Pagamento pendente (N)' só é oferecido na lista", () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: paymentsMessages.agenda.filterPendingAria }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dia" }));
    expect(
      screen.queryByRole("button", { name: paymentsMessages.agenda.filterPendingAria }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Semana" }));
    expect(
      screen.queryByRole("button", { name: paymentsMessages.agenda.filterPendingAria }),
    ).toBeNull();
  });

  it("selo aparece no item concluído pendente e some no quitado", () => {
    renderPage();
    expect(screen.getAllByTestId("payment-badge")).toHaveLength(1);
  });

  it("ações do card quebram linha no mobile e não escondem controles", () => {
    renderPage();

    const actionRows = screen.getAllByTestId("agenda-item-actions");
    expect(actionRows.length).toBeGreaterThan(0);

    for (const row of actionRows) {
      // A linha de ações pode encolher e quebrar: é o que elimina os 17 px de
      // overflow em 375 px (RNF-02), sem `overflow-hidden` nem esconder botão.
      expect(row.className).toContain("flex-wrap");
      expect(row.className).toContain("min-w-0");
      expect(row.className).toContain("w-full");

      for (const button of row.querySelectorAll("button")) {
        expect(button.className).toContain("max-w-full");
      }
    }

    // O contêiner pai (selo + ações) também precisa quebrar linha; caso
    // contrário o `max-content` das ações vaza do card.
    const parent = actionRows[0].parentElement;
    expect(parent?.className).toContain("flex-wrap");
    expect(parent?.className).toContain("min-w-0");
    expect(parent?.className).toContain("w-full");

    // Nenhum controle é escondido na correção.
    expect(
      screen.getAllByRole("button", { name: /Abrir pagamento do atendimento/ }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
    expect(screen.getAllByText("Enviar mensagem")).toHaveLength(2);
  });

  it("barra de filtros quebra linha e usa controles fluidos (anti-overflow)", () => {
    renderPage();

    const bar = screen.getByTestId("agenda-filter-bar");
    expect(bar.className).toContain("flex-wrap");
    expect(bar.className).toContain("min-w-0");

    for (const testId of [
      "agenda-filter-professional",
      "agenda-filter-service",
      "agenda-filter-status",
    ]) {
      const group = screen.getByTestId(testId);
      expect(group.className).toContain("min-w-0");
      expect(group.className).toContain("lg:w-[");
    }

    // Triggers não fixam 200/220 px: ocupam a largura do grupo.
    for (const id of ["agenda-profissional", "agenda-servico", "agenda-status"]) {
      const trigger = document.getElementById(id);
      expect(trigger?.className).toContain("w-full");
      expect(trigger?.className ?? "").not.toMatch(/w-\[(200|220)px\]/);
    }
  });

  it("calendário Dia/Semana mostra a ação 'Pagamento' quando o recurso está ativo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Dia" }));
    expect(
      screen.getAllByRole("button", {
        name: /Abrir pagamento do atendimento/,
      }),
    ).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Semana" }));
    expect(
      screen.getAllByRole("button", {
        name: /Abrir pagamento do atendimento/,
      }),
    ).not.toHaveLength(0);
  });

  it.each([false, null] as const)(
    "calendário Dia/Semana NÃO mostra a ação 'Pagamento' com payments=%s",
    (state) => {
      mocks.payments = state;
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Dia" }));
      expect(screen.getByText("Ana")).toBeTruthy();
      expect(
        screen.queryByRole("button", {
          name: /Abrir pagamento do atendimento/,
        }),
      ).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Semana" }));
      expect(
        screen.queryByRole("button", {
          name: /Abrir pagamento do atendimento/,
        }),
      ).toBeNull();
    },
  );
});
