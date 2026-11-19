// @vitest-environment happy-dom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentDrawer } from "@/app/agenda/AppointmentDrawer";
import { draftKey } from "@/app/agenda/useAppointmentDraft";
import type { AppointmentWithRelations } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  role: "admin",
  payments: false as boolean | null,
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
    data: [{ id: S_ID, name: "Corte", duration_minutes: 60, price_cents: 8000 }],
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
  useAvailableSlots: () => ({
    slots: [
      { startUtc: "2026-11-10T12:30:00Z", endUtc: "x", label: "09:30" },
      { startUtc: "2026-11-10T17:00:00Z", endUtc: "x", label: "14:00" },
    ],
    isLoading: false,
    isEnabled: true,
  }),
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
  usePlanEntitlements: () => null,
}));
vi.mock("@/app/agenda/prontuario/ProntuarioTab", () => ({
  ProntuarioTab: () => null,
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
  mocks.canRegisterPayments = true;
  mocks.createMutate.mockReset().mockResolvedValue({});
  mocks.updateMutate.mockReset().mockResolvedValue({});
});

function baseProps(overrides = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    appointment: null,
    day: "2026-11-10",
    timeZone: "America/Sao_Paulo",
    lockedProfessionalId: null,
    dayAppointments: [],
    prefill: null,
    ...overrides,
  };
}

function selectTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  // Radix Tabs seleciona no mousedown/focus (click sozinho não troca).
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

function renderDrawer(props = {}) {
  return render(
    <MemoryRouter>
      <AppointmentDrawer {...baseProps(props)} />
    </MemoryRouter>,
  );
}

function editingAppointment(): AppointmentWithRelations {
  return {
    id: AP_ID,
    customer_id: C_ID,
    professional_id: P_ID,
    service_id: S_ID,
    combo_id: null,
    starts_at: "2026-11-10T12:30:00.000Z",
    ends_at: "2026-11-10T13:30:00.000Z",
    price_cents: 8000,
    status: "confirmado",
    confirmed_at: "2026-11-09T10:00:00.000Z",
    confirmed_via: "operador",
    created_at: "2026-11-01T10:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: true },
    services: { name: "Corte" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
  } as unknown as AppointmentWithRelations;
}

describe("AppointmentDrawer", () => {
  it("renderiza abas Dados / Pagamento / Histórico e wizard no criar", () => {
    renderDrawer();
    expect(screen.getByRole("tab", { name: "Dados" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Pagamento" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Histórico" })).toBeDefined();
    expect(screen.getByText(/Passo 1 de 3/)).toBeDefined();
    expect(screen.getAllByText(/Quem e o quê/)).toHaveLength(2);
  });

  it("edição abre direto nos Dados sem stepper", () => {
    renderDrawer({ appointment: editingAppointment() });
    expect(screen.queryByText(/Passo 1 de 3/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Salvar alterações" }),
    ).toBeDefined();
  });

  it("wizard bloqueia avanço com passo inválido e amostra rascunho", async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));
    // Continua no passo 1 (validação por passo).
    expect(screen.getByText(/Passo 1 de 3/)).toBeDefined();

    // Rascunho completo restaura e libera o fluxo até a revisão.
    window.localStorage.setItem(
      draftKey("t-1", "2026-11-10"),
      JSON.stringify({
        customerId: C_ID,
        professionalId: P_ID,
        selection: { kind: "service", serviceId: S_ID },
        date: "2026-11-10",
        time: "09:30",
      }),
    );
    cleanup();
    renderDrawer();
    expect(screen.getByText(/Rascunho restaurado/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));
    await waitFor(() => {
      expect(screen.getByText(/Passo 2 de 3/)).toBeDefined();
    });
    // SlotPicker por turnos dentro do passo 2.
    expect(screen.getByText("Manhã")).toBeDefined();
    expect(screen.getByText("Tarde")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));
    await waitFor(() => {
      expect(screen.getByText(/Passo 3 de 3/)).toBeDefined();
    });
    expect(screen.getByText(/R\$ 80,00/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => {
      expect(mocks.createMutate).toHaveBeenCalledOnce();
    });
    expect(mocks.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: C_ID, priceCents: 8000 }),
    );
    // Rascunho limpo após salvar.
    expect(window.localStorage.getItem(draftKey("t-1", "2026-11-10"))).toBeNull();
  });

  it("descartar rascunho exige confirmação (dois cliques)", () => {
    window.localStorage.setItem(
      draftKey("t-1", "2026-11-10"),
      JSON.stringify({
        customerId: C_ID,
        professionalId: P_ID,
        selection: { kind: "service", serviceId: S_ID },
        date: "2026-11-10",
        time: "09:30",
      }),
    );
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(window.localStorage.getItem(draftKey("t-1", "2026-11-10"))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar descarte/ }));
    expect(window.localStorage.getItem(draftKey("t-1", "2026-11-10"))).toBeNull();
  });

  it("fecha com dirty pede confirmação antes de descartar", () => {
    const onOpenChange = vi.fn();
    renderDrawer({ appointment: editingAppointment(), onOpenChange });
    fireEvent.change(screen.getByLabelText("Data"), {
      target: { value: "2026-11-11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    // Não fechou de primeira: pede confirmação.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Descartar alterações/)).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: /Descartar e fechar/ }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("aba Pagamento indisponível mostra estado-guia + CTA sem quebrar", () => {
    mocks.payments = false;
    renderDrawer({ appointment: editingAppointment() });
    selectTab("Pagamento");
    expect(screen.getByText(/Fechamento indisponível/)).toBeDefined();
    const cta = screen.getByRole("link", { name: /Ver plano/ });
    expect(cta.getAttribute("href")).toBe("/app/config/plano");
  });

  it("aba Pagamento em criação pede para salvar primeiro", () => {
    mocks.payments = true;
    renderDrawer();
    selectTab("Pagamento");
    expect(screen.getByText(/Salve o agendamento/)).toBeDefined();
  });

  it("receptionist não vê R$ na revisão", async () => {
    mocks.role = "receptionist";
    window.localStorage.setItem(
      draftKey("t-1", "2026-11-10"),
      JSON.stringify({
        customerId: C_ID,
        professionalId: P_ID,
        selection: { kind: "service", serviceId: S_ID },
        date: "2026-11-10",
        time: "09:30",
      }),
    );
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));
    await waitFor(() => {
      expect(screen.getByText(/Passo 2 de 3/)).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));
    await waitFor(() => {
      expect(screen.getByText(/Passo 3 de 3/)).toBeDefined();
    });
    expect(screen.queryByText(/R\$ 80,00/)).toBeNull();
  });

  it("aba Histórico em edição é read-only com linha do tempo", () => {
    renderDrawer({ appointment: editingAppointment() });
    selectTab("Histórico");
    expect(screen.getByText(/Criado em/)).toBeDefined();
    expect(screen.getByText(/Confirmado em/)).toBeDefined();
  });

  it("prende o foco dentro do drawer ao abrir", async () => {
    renderDrawer();
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("drawer mobile é bottom sheet sem scroll-x", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[85vh]");
    expect(dialog.className).toContain("overflow-x-clip");
  });

  it("reload-no-passo-2-mantém-time: trocar slot persiste no rascunho", async () => {
    window.localStorage.setItem(
      draftKey("t-1", "2026-11-10"),
      JSON.stringify({
        customerId: C_ID,
        professionalId: P_ID,
        selection: { kind: "service", serviceId: S_ID },
        date: "2026-11-10",
        time: "09:30",
      }),
    );
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));
    await waitFor(() => {
      expect(screen.getByText(/Passo 2 de 3/)).toBeDefined();
    });
    // Troca o slot no passo 2 (antes só salvava no Avançar).
    fireEvent.click(
      screen.getByRole("radio", { name: "14:00, turno da tarde" }),
    );
    await waitFor(() => {
      const raw = window.localStorage.getItem(draftKey("t-1", "2026-11-10"));
      expect(raw).not.toBeNull();
      expect((JSON.parse(raw as string) as { time: string }).time).toBe(
        "14:00",
      );
    });
    // Reload: novo mount encontra o time trocado no passo 2.
    cleanup();
    renderDrawer();
    const raw = window.localStorage.getItem(draftKey("t-1", "2026-11-10"));
    expect((JSON.parse(raw as string) as { time: string }).time).toBe(
      "14:00",
    );
    expect(screen.getByText(/Rascunho restaurado/)).toBeDefined();
  });

  it("D1: Escape devolve o foco ao trigger que abriu", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Novo agendamento
          </button>
          <AppointmentDrawer {...baseProps({ open, onOpenChange: setOpen })} />
        </>
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole("button", { name: "Novo agendamento" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
    });
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("D2: botão Fechar tem área clicável ≥24px (WCAG 2.2 AA)", () => {
    renderDrawer();
    const close = screen.getByRole("button", { name: "Fechar" });
    // happy-dom não faz layout: h-6/w-6 = 24px garantem o alvo mínimo.
    expect(close.className).toContain("h-6");
    expect(close.className).toContain("w-6");
    expect(close.querySelector("svg")?.className).toContain("h-4");
  });
});
