// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  subscriptionStatus: "ativo" as string | null,
  optIn: true,
  templateActive: true,
  changeMutate: vi.fn(),
  sendMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  navigate: vi.fn(),
  appointments: [] as unknown[],
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
    warning: (...args: unknown[]) => mocks.toastWarning(...args),
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

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
    mutateAsync: mocks.changeMutate,
    isPending: false,
  }),
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
    role: "admin",
    tenant: { timezone: "America/Sao_Paulo" },
    userId: "u-1",
    subscriptionStatus: mocks.subscriptionStatus,
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
vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => null,
}));
vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({ mutateAsync: mocks.sendMutate }),
}));
vi.mock("@/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({
    data: [{ template_key: "confirmacao", active: mocks.templateActive }],
  }),
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

function pendingAppointment(optIn: boolean) {
  return {
    id: "ap-1",
    customer_id: "c-1",
    professional_id: "pr-1",
    service_id: "s-1",
    combo_id: null,
    starts_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    price_cents: 10000,
    status: "pendente",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-10T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: optIn },
    services: { name: "Corte" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
  };
}

afterEach(cleanup);

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
  mocks.subscriptionStatus = "ativo";
  mocks.optIn = true;
  mocks.templateActive = true;
  mocks.changeMutate.mockReset().mockResolvedValue({});
  mocks.sendMutate.mockReset().mockResolvedValue({ outcome: "sent" });
  mocks.toastSuccess.mockClear();
  mocks.toastError.mockClear();
  mocks.toastWarning.mockClear();
  mocks.navigate.mockClear();
  mocks.appointments = [pendingAppointment(true)];
});

function renderPage() {
  return render(
    <MemoryRouter>
      <AgendaPage />
    </MemoryRouter>,
  );
}

describe("AgendaPage — gating ADR-07 (T2.0 + R10)", () => {
  it("confirmar com opt-in + toggle + janela dispara a régua existente", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Confirmado" }));
    await waitFor(() => {
      expect(mocks.changeMutate).toHaveBeenCalledWith({
        id: "ap-1",
        from: "pendente",
        to: "confirmado",
      });
    });
    await waitFor(() => {
      expect(mocks.sendMutate).toHaveBeenCalledWith({
        template: "confirmacao",
        customerId: "c-1",
        appointmentId: "ap-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Confirmado. Mensagem enviada no WhatsApp.",
    );
  });

  it("confirmar sem opt-in muda status sem chamar WhatsApp (silencioso)", async () => {
    mocks.appointments = [pendingAppointment(false)];
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Confirmado" }));
    await waitFor(() => {
      expect(mocks.changeMutate).toHaveBeenCalled();
    });
    expect(mocks.sendMutate).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Status atualizado.");
  });

  it("confirmar com toggle desligado muda status sem chamar WhatsApp", async () => {
    mocks.templateActive = false;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Confirmado" }));
    await waitFor(() => {
      expect(mocks.changeMutate).toHaveBeenCalled();
    });
    expect(mocks.sendMutate).not.toHaveBeenCalled();
  });

  it("tenant bloqueado bloqueia escrita e leva à quitação (R10)", async () => {
    mocks.subscriptionStatus = "bloqueado";
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Confirmado" }));
    expect(mocks.changeMutate).not.toHaveBeenCalled();
    expect(mocks.sendMutate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Assinatura pendente. Regularize para continuar.",
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/app/quitacao");
  });
});
