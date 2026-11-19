// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgendaPage } from "@/app/agenda/AgendaPage";
import type { DepositCharge } from "@/lib/validations/deposit";

const mocks = vi.hoisted(() => ({
  appointments: [] as unknown[],
  depositData: null as DepositCharge | null,
  depositRefetch: vi.fn(),
  rpc: vi.fn(),
  drawerProps: null as Record<string, unknown> | null,
}));

const CHARGE: DepositCharge = {
  id: "ch-1",
  status: "pendente",
  amountCents: 3000,
  pixQrCode: null,
  pixCopiaECola: "pix-test",
  expiresAt: null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/hooks/useDepositCharge", () => ({
  useDepositCharge: (appointmentId: string | null) => {
    if (appointmentId === null) return { data: null, refetch: mocks.depositRefetch };
    return { data: mocks.depositData, refetch: mocks.depositRefetch };
  },
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
    mutateAsync: vi.fn(),
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
    servicoLabelSingular: "Serviço",
    profissionalLabelSingular: "Profissional",
    clienteLabel: "Cliente",
  }),
}));
vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ commission: false, payments: false }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canManageAppointments: true,
    canScheduleForAnyProfessional: true,
    canSendWhatsAppMessage: true,
    canViewCommission: false,
    canViewFinancials: false,
    canRegisterPayments: false,
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: { id: "t-1", timezone: "America/Sao_Paulo" },
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
vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => null,
}));
vi.mock("@/hooks/useValidPackageCredit", () => ({
  hasValidPackageCredit: () => Promise.resolve(false),
}));
vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));
vi.mock("@/hooks/useAutoSendConfirmation", () => ({
  useAutoSendConfirmation: () => ({ maybeSendConfirmation: vi.fn() }),
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
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

vi.mock("@/app/agenda/AppointmentDrawer", () => ({
  AppointmentDrawer: (props: Record<string, unknown>) => {
    mocks.drawerProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="drawer-mock">
        <button
          type="button"
          onClick={() =>
            (props.onResendDepositQr as () => void)?.()
          }
        >
          resend-mock
        </button>
        <button
          type="button"
          onClick={() =>
            (props.onCancelDepositCharge as () => void)?.()
          }
        >
          cancel-mock
        </button>
      </div>
    );
  },
}));
vi.mock("@/app/agenda/pagamentos/PaymentCaptureDialog", () => ({
  PaymentCaptureDialog: () => null,
}));
vi.mock("@/app/agenda/pagamentos/AppointmentSettlementDialog", () => ({
  AppointmentSettlementDialog: () => null,
}));
vi.mock("@/app/agenda/StatusChangeConfirm", () => ({
  StatusChangeConfirm: () => null,
}));
vi.mock("@/app/agenda/BulkStatusConfirm", () => ({
  BulkStatusConfirm: () => null,
}));
vi.mock("@/app/whatsapp/SendMessageDialog", () => ({
  SendMessageDialog: () => null,
}));

function depositAppointment() {
  return {
    id: "ap-dep",
    customer_id: "c-1",
    professional_id: "pr-1",
    service_id: "s-1",
    combo_id: null,
    starts_at: "2026-11-12T12:00:00.000Z",
    ends_at: "2026-11-12T13:00:00.000Z",
    price_cents: 10000,
    status: "aguardando_deposito",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-01T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: true },
    services: { name: "Corte" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
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
  mocks.appointments = [depositAppointment()];
  mocks.depositData = CHARGE;
  mocks.depositRefetch.mockReset().mockResolvedValue({ isError: false });
  mocks.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  mocks.drawerProps = null;
});

afterEach(cleanup);

describe("AgendaPage — fiação do depósito (ADR-12 / RF-06)", () => {
  it("abre o drawer com a charge real da Edge + handlers", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    await waitFor(() =>
      expect(screen.getByTestId("drawer-mock")).toBeDefined(),
    );
    expect(mocks.drawerProps?.depositCharge).toEqual(CHARGE);
    expect(typeof mocks.drawerProps?.onResendDepositQr).toBe("function");
    expect(typeof mocks.drawerProps?.onCancelDepositCharge).toBe("function");
  });

  it("reenviar QR recarrega a charge escopada", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await waitFor(() =>
      expect(screen.getByTestId("drawer-mock")).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "resend-mock" }));
    await waitFor(() =>
      expect(mocks.depositRefetch).toHaveBeenCalledTimes(1),
    );
  });

  it("cancelar chama o RPC escopado e fecha o drawer", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await waitFor(() =>
      expect(screen.getByTestId("drawer-mock")).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "cancel-mock" }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("cancel_deposit_appointment", {
        p_tenant_id: "t-1",
        p_appointment_id: "ap-dep",
        p_actor_id: "u-1",
        p_refund_policy: null,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("drawer-mock")).toBeNull(),
    );
  });
});
