// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("@/hooks/useAppointments", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/hooks/useAppointments")>();
  return {
    ...original,
    useUpdateAppointment: () => ({
      mutateAsync: mocks.mutateAsync,
      isPending: false,
    }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AgendaCalendarDay } from "@/app/agenda/AgendaCalendarDay";
import { toTenantLocal } from "@/lib/datetime";
import type {
  AppointmentWithRelations,
  Professional,
  WorkingHour,
} from "@/types/domain";

afterEach(() => {
  cleanup();
  mocks.mutateAsync.mockReset();
});

const TIME_ZONE = "America/Sao_Paulo";
const DAY = "2026-11-10"; // terça-feira (weekday 2).

const PROFESSIONALS = [
  { id: "pr-1", name: "Bia" },
  { id: "pr-2", name: "Cris" },
] as unknown as Professional[];

// Expediente 09:00–12:00 na terça para as duas profissionais.
const WORKING_HOURS = [
  { professional_id: "pr-1", weekday: 2, start_time: "09:00", end_time: "12:00" },
  { professional_id: "pr-2", weekday: 2, start_time: "09:00", end_time: "12:00" },
] as unknown as WorkingHour[];

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

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function renderDay(
  appts = [appointment()],
  day = DAY,
  workingHours = WORKING_HOURS,
) {
  const onChangeStatus = vi.fn();
  return render(
    <AgendaCalendarDay
      day={day}
      timeZone={TIME_ZONE}
      appointments={appts}
      professionals={PROFESSIONALS}
      singleColumn={false}
      workingHours={workingHours}
      weekday={weekdayOf(day)}
      onOpenAppointment={vi.fn()}
      onCreateAt={vi.fn()}
      movable
      quickActions={{
        canManage: true,
        paymentsFeature: false,
        onChangeStatus,
        onEdit: vi.fn(),
        onDuplicate: vi.fn(),
      }}
    />,
  );
}

describe("AgendaCalendarDay — grade 30min (ADR-03)", () => {
  it("oferece criar em slots de 30min", () => {
    renderDay();
    // Uma coluna por profissional: cada slot aparece 2x.
    expect(
      screen.getAllByRole("button", { name: "Criar agendamento às 09:00" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Criar agendamento às 09:30" }),
    ).toHaveLength(2);
  });

  it("rotula a faixa fora de expediente", () => {
    // Grade só 09–10, mas a janela estende até 12 pelo expediente.
    const shortGrid = [
      {
        professional_id: "pr-1",
        weekday: 2,
        start_time: "09:00",
        end_time: "12:00",
      },
      {
        professional_id: "pr-2",
        weekday: 2,
        start_time: "09:00",
        end_time: "12:00",
      },
    ] as unknown as WorkingHour[];
    renderDay(
      [
        appointment(),
        appointment({
          id: "ap-2",
          // 14:00–15:00 BRT: estende a janela para além do expediente.
          starts_at: "2026-11-10T17:00:00.000Z",
          ends_at: "2026-11-10T18:00:00.000Z",
        }),
      ],
      DAY,
      shortGrid,
    );
    // Expediente 09–12, janela até 11:30+ → faixa 12h+ rotulada.
    expect(screen.getAllByText("Fora de expediente").length).toBeGreaterThan(0);
  });

  it("mostra a linha do agora quando o dia é hoje", () => {
    const now = toTenantLocal(new Date(), TIME_ZONE);
    const today = `${now.year.toString().padStart(4, "0")}-${now.month
      .toString()
      .padStart(2, "0")}-${now.day.toString().padStart(2, "0")}`;
    const todayWeekday = weekdayOf(today);
    // Grade o dia inteiro para garantir que o agora caiba na janela.
    const fullDay = (["pr-1", "pr-2"] as const).map((professional_id) => ({
      professional_id,
      weekday: todayWeekday,
      start_time: "00:00",
      end_time: "23:59",
    })) as unknown as WorkingHour[];
    renderDay([], today, fullDay);
    // Uma linha por coluna de profissional.
    expect(screen.getAllByTestId("now-line")).toHaveLength(2);
  });

  it("expõe região aria-live para anunciar movimentos", () => {
    renderDay();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("recusa soltar em profissional diferente no dragover", () => {
    mocks.mutateAsync.mockResolvedValueOnce(appointment());
    renderDay();
    const dragSource = screen.getByTestId("day-block-drag-ap-1");
    fireEvent.dragStart(dragSource);
    // Coluna da Cris (segunda coluna): dragover deve ser recusado
    // (fireEvent retorna true quando preventDefault NÃO foi chamado).
    const crisColumn = screen.getByTestId("day-column-pr-2");
    const refused = fireEvent.dragOver(crisColumn);
    expect(refused).toBe(true);
    // Coluna da Bia: aceita (preventDefault chamado → retorna false).
    const biaColumn = screen.getByTestId("day-column-pr-1");
    const accepted = fireEvent.dragOver(biaColumn);
    expect(accepted).toBe(false);
  });

  it("soltar persiste o novo horário e re-renderiza", async () => {
    mocks.mutateAsync.mockResolvedValueOnce(appointment());
    const onCreateAt = vi.fn();
    render(
      <AgendaCalendarDay
        day={DAY}
        timeZone={TIME_ZONE}
        appointments={[appointment()]}
        professionals={PROFESSIONALS}
        singleColumn={false}
        workingHours={WORKING_HOURS}
        weekday={weekdayOf(DAY)}
        onOpenAppointment={vi.fn()}
        onCreateAt={onCreateAt}
        movable
        quickActions={{
          canManage: true,
          paymentsFeature: false,
          onChangeStatus: vi.fn(),
          onEdit: vi.fn(),
          onDuplicate: vi.fn(),
        }}
      />,
    );
    fireEvent.dragStart(screen.getByTestId("day-block-drag-ap-1"));
    const biaColumn = screen.getByTestId("day-column-pr-1");
    // happy-dom não tem layout (rect zerado) e descarta `clientY` no init de
    // DragEvent: fixa o rect e despacha o drop com `clientY` atribuído.
    const rect = { top: 100, height: 200, left: 0, width: 100 };
    vi.spyOn(biaColumn, "getBoundingClientRect").mockReturnValue({
      ...rect,
      bottom: 300,
      right: 100,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clientY?: number };
    // 28px abaixo do topo (hora de 56px) = +30min → 09:00 vira 09:30.
    dropEvent.clientY = 128;
    fireEvent(biaColumn, dropEvent);
    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    });
    const payload = mocks.mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe("ap-1");
    // 09:30–10:30 BRT preservando a duração de 60min.
    expect(payload.startsAt).toBe("2026-11-10T12:30:00.000Z");
    expect(payload.endsAt).toBe("2026-11-10T13:30:00.000Z");
  });
});
