// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nenhuma falha de cobrança é silenciosa: concluir o atendimento sem gerar o
 * PIX precisa avisar (o gancho roda para `canManageAppointments`, não só para
 * admin — a Edge Function aceita admin/receptionist/professional).
 */

const { warningMock, chargeMock, statusMock, onClose, singleMock } = vi.hoisted(() => ({
  warningMock: vi.fn(),
  chargeMock: vi.fn(),
  statusMock: vi.fn(),
  onClose: vi.fn(),
  singleMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: singleMock }) }),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: warningMock,
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canViewCommission: false }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ commission: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));

vi.mock("@/hooks/useAppointments", () => ({
  mapSchedulingError: (error: unknown) => String(error),
  useChangeAppointmentStatus: () => ({
    mutateAsync: statusMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useCharges", () => ({
  useCreateCharge: () => ({ mutateAsync: chargeMock, isPending: false }),
}));

import { StatusChangeConfirm } from "@/app/agenda/StatusChangeConfirm";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import type { AppointmentWithRelations } from "@/types/domain";

const APPOINTMENT = {
  id: "ap-1",
  status: "confirmado",
} as unknown as AppointmentWithRelations;

beforeEach(() => {
  warningMock.mockReset();
  chargeMock.mockReset();
  statusMock.mockReset();
  singleMock.mockReset();
  onClose.mockReset();
  statusMock.mockResolvedValue(undefined);
  // Sem vínculo pós-concluir por padrão: segue a cobrança (comportamento anterior).
  singleMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => cleanup());

describe("StatusChangeConfirm — cobrança PIX", () => {
  it("avisa quando o atendimento conclui mas a cobrança falha", async () => {
    chargeMock.mockRejectedValue(new Error("Asaas não configurado."));
    render(
      <StatusChangeConfirm
        change={{ appointment: APPOINTMENT, to: "concluido" }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(warningMock).toHaveBeenCalledWith(
        "Atendimento concluído, mas a cobrança PIX não foi gerada.",
      ),
    );
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("não avisa quando a cobrança é gerada", async () => {
    chargeMock.mockResolvedValue({ charge_id: "ch-1", pix_copy_paste: "pix" });
    render(
      <StatusChangeConfirm
        change={{ appointment: APPOINTMENT, to: "concluido" }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await screen.findByText(paymentsMessages.pix.generatedTitle);
    expect(warningMock).not.toHaveBeenCalled();
  });

  it("auto-vínculo pós-concluir (refetch com crédito) pula o PIX sem dupla cobrança", async () => {
    // Pré-concluir sempre null na sessão do pacote; o trigger gravou no concluir.
    singleMock.mockResolvedValueOnce({
      data: { package_credit_id: "cr-1" },
      error: null,
    });
    chargeMock.mockRejectedValue(new Error("não deve ser chamado"));
    render(
      <StatusChangeConfirm
        change={{ appointment: APPOINTMENT, to: "concluido" }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(chargeMock).not.toHaveBeenCalled();
    expect(warningMock).not.toHaveBeenCalled();
  });
});
