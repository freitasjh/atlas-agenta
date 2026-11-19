// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppointmentBlock } from "@/app/agenda/AppointmentBlock";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import type {
  AppointmentStatus,
  AppointmentWithRelations,
} from "@/types/domain";

afterEach(cleanup);

function appointment(
  overrides: Partial<AppointmentWithRelations> = {},
): AppointmentWithRelations {
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
    created_at: "2026-11-01T00:00:00.000Z",
    customers: { name: "Ana", whatsapp_opt_in: false },
    services: { name: "Corte" },
    combos: null,
    professionals: { name: "Bia" },
    commission_cents: null,
    ...overrides,
  } as unknown as AppointmentWithRelations;
}

function renderWithActions(
  status: AppointmentStatus,
  overrides: Record<string, unknown> = {},
) {
  const onChangeStatus = vi.fn();
  const onEdit = vi.fn();
  const onDuplicate = vi.fn();
  const onAnnounce = vi.fn();
  const onCommitMove = vi.fn();
  render(
    <AppointmentBlock
      appointment={appointment({ status })}
      timeZone="America/Sao_Paulo"
      onOpen={vi.fn()}
      canRegisterPayments={false}
      messages={paymentsMessages}
      quickActions={{
        canManage: true,
        paymentsFeature: false,
        onChangeStatus,
        onEdit,
        onDuplicate,
      }}
      dnd={{
        draggable: true,
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onCommitMove,
        onAnnounce,
      }}
      {...overrides}
    />,
  );
  return { onChangeStatus, onEdit, onDuplicate, onAnnounce, onCommitMove };
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /Ações do agendamento/ }));
}

describe("AppointmentBlock — quick actions por status", () => {
  it("pendente oferece Confirmar em 1 clique", () => {
    const { onChangeStatus } = renderWithActions("pendente");
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onChangeStatus).toHaveBeenCalledOnce();
    expect(onChangeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ap-1" }),
      "confirmado",
    );
  });

  it("confirmado oferece Iniciar; em_atendimento oferece Concluir", () => {
    const confirmado = renderWithActions("confirmado");
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    expect(confirmado.onChangeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ap-1" }),
      "em_atendimento",
    );
    cleanup();

    const atendimento = renderWithActions("em_atendimento");
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(atendimento.onChangeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ap-1" }),
      "concluido",
    );
  });

  it("status final não tem ação primária; overflow lista o restante", () => {
    renderWithActions("concluido");
    openPanel();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Concluir" })).toBeNull();
    // Overflow existe para Editar/Duplicar mesmo sem transições.
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Duplicar" })).toBeTruthy();
  });

  it("sem canManage não mostra ações", () => {
    renderWithActions("pendente", {
      quickActions: {
        canManage: false,
        paymentsFeature: false,
        onChangeStatus: vi.fn(),
        onEdit: vi.fn(),
        onDuplicate: vi.fn(),
      },
    });
    expect(
      screen.queryByRole("button", { name: /Ações do agendamento/ }),
    ).toBeNull();
  });

  it("Duplicar chama onDuplicate sem copiar nada (só o id de origem)", () => {
    const { onDuplicate } = renderWithActions("confirmado");
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));
    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(onDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ap-1" }),
    );
  });

  it("teclado: setas anunciam, Enter confirma, Esc cancela", () => {
    const { onAnnounce, onCommitMove } = renderWithActions("pendente");
    const main = screen.getByRole("button", { name: /Ana, Corte às 09:00/ });
    fireEvent.keyDown(main, { key: "ArrowDown" });
    expect(onAnnounce).toHaveBeenCalledWith(
      expect.stringContaining("09:30"),
    );
    expect(screen.getByText(/09:30/)).toBeTruthy();
    fireEvent.keyDown(main, { key: "Enter" });
    expect(onCommitMove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ap-1" }),
      570,
    );
    cleanup();

    const second = renderWithActions("pendente");
    const main2 = screen.getByRole("button", { name: /Ana, Corte às 09:00/ });
    fireEvent.keyDown(main2, { key: "ArrowDown" });
    fireEvent.keyDown(main2, { key: "Escape" });
    expect(second.onAnnounce).toHaveBeenCalledWith(
      expect.stringContaining("cancelado"),
    );
    expect(second.onCommitMove).not.toHaveBeenCalled();
  });
});
