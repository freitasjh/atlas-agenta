// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Baixa de pacote ao concluir (ADR-06): o trigger já consumiu 1 sessão no
 * mesmo commit — a UI só anuncia com toast de 5s + Desfazer (correção lógica,
 * nunca DELETE). Duplo clique no Confirmar não dispara 2 mutações (botão
 * desabilita em pending — idempotência é do estado final `concluido`).
 */

const { infoMock, successMock, statusMock, chargeMock, onClose, singleMock } = vi.hoisted(
  () => ({
    infoMock: vi.fn(),
    successMock: vi.fn(),
    statusMock: vi.fn(),
    chargeMock: vi.fn(),
    onClose: vi.fn(),
    singleMock: vi.fn(),
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: singleMock }) }),
    }),
  },
}));

let pending = false;

vi.mock("sonner", () => ({
  toast: {
    success: successMock,
    error: vi.fn(),
    warning: vi.fn(),
    info: infoMock,
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
    get isPending() {
      return pending;
    },
  }),
}));

vi.mock("@/hooks/useCharges", () => ({
  useCreateCharge: () => ({ mutateAsync: chargeMock, isPending: false }),
}));

import { StatusChangeConfirm } from "@/app/agenda/StatusChangeConfirm";
import type { AppointmentWithRelations } from "@/types/domain";

function appointmentWithPackage() {
  return {
    id: "ap-1",
    status: "em_atendimento",
    package_credit_id: "cr-1",
  } as unknown as AppointmentWithRelations;
}

beforeEach(() => {
  pending = false;
  infoMock.mockReset();
  successMock.mockReset();
  statusMock.mockReset();
  chargeMock.mockReset();
  singleMock.mockReset();
  onClose.mockReset();
  statusMock.mockResolvedValue(undefined);
  chargeMock.mockRejectedValue(new Error("sem cobrança"));
  // Refetch confirma o vínculo por padrão (trigger consumiu no concluir).
  singleMock.mockResolvedValue({ data: { package_credit_id: "cr-1" }, error: null });
});

afterEach(() => cleanup());

describe("StatusChangeConfirm — baixa de pacote (ADR-06)", () => {
  it("concluir com pacote mostra toast de baixa com undo de 5s", async () => {
    render(
      <StatusChangeConfirm
        change={{ appointment: appointmentWithPackage(), to: "concluido" }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        expect.stringMatching(/sessão baixada do pacote/i),
        expect.objectContaining({
          duration: 5000,
          action: expect.objectContaining({ label: "Desfazer" }),
        }),
      ),
    );
    // A UI nunca chama redeem direto após concluir (só o trigger consome) e
    // nunca gera PIX sobre a sessão já paga na venda (sem dupla cobrança).
    expect(chargeMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Desfazer orienta correção lógica sem apagar nada", async () => {
    render(
      <StatusChangeConfirm
        change={{ appointment: appointmentWithPackage(), to: "concluido" }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    const options = successMock.mock.calls[0]?.[1] as
      | { action?: { onClick?: () => void } }
      | undefined;
    options?.action?.onClick?.();
    expect(infoMock).toHaveBeenCalledWith(
      expect.stringMatching(/nova venda de pacote/i),
    );
  });

  it("concluir sem pacote mantém o toast padrão", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: null });
    const plain = {
      id: "ap-2",
      status: "em_atendimento",
      package_credit_id: null,
    } as unknown as AppointmentWithRelations;
    render(
      <StatusChangeConfirm
        change={{ appointment: plain, to: "concluido" }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Status atualizado."),
    );
  });

  it("auto-vínculo: pré-concluir null + refetch com crédito pula o PIX", async () => {
    // O guard pré-concluir é sempre null na sessão do pacote; o trigger gravou
    // no concluir — o refetch decide, sem dupla cobrança.
    singleMock.mockResolvedValueOnce({
      data: { package_credit_id: "cr-9" },
      error: null,
    });
    const plain = {
      id: "ap-9",
      status: "em_atendimento",
      package_credit_id: null,
    } as unknown as AppointmentWithRelations;
    render(
      <StatusChangeConfirm
        change={{ appointment: plain, to: "concluido" }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        expect.stringMatching(/sessão baixada do pacote/i),
        expect.objectContaining({ duration: 5000 }),
      ),
    );
    expect(chargeMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("botão desabilita em pending: duplo clique não conclui 2x", () => {
    pending = true;
    render(
      <StatusChangeConfirm
        change={{ appointment: appointmentWithPackage(), to: "concluido" }}
        onClose={onClose}
      />,
    );
    const confirm = screen.getByRole("button", { name: /aplicando/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm);
    expect(statusMock).not.toHaveBeenCalled();
  });
});
