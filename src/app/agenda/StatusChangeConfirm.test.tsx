// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nenhuma falha de cobrança é silenciosa: concluir o atendimento sem gerar o
 * PIX precisa avisar (o gancho roda para `canManageAppointments`, não só para
 * admin — a Edge Function aceita admin/receptionist/professional).
 */

const { warningMock, chargeMock, statusMock, onClose } = vi.hoisted(() => ({
  warningMock: vi.fn(),
  chargeMock: vi.fn(),
  statusMock: vi.fn(),
  onClose: vi.fn(),
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
import type { AppointmentWithRelations } from "@/types/domain";

const APPOINTMENT = {
  id: "ap-1",
  status: "confirmado",
} as unknown as AppointmentWithRelations;

beforeEach(() => {
  warningMock.mockReset();
  chargeMock.mockReset();
  statusMock.mockReset();
  onClose.mockReset();
  statusMock.mockResolvedValue(undefined);
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

    await screen.findByText("Cobrança PIX gerada");
    expect(warningMock).not.toHaveBeenCalled();
  });
});
