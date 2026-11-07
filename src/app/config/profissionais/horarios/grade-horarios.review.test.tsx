// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeekScheduleForm } from "@/app/config/profissionais/horarios/WeekScheduleForm";
import { OverrideFormDialog } from "@/app/config/profissionais/horarios/OverrideFormDialog";
import { ScheduleValidityForm } from "@/app/config/profissionais/horarios/ScheduleValidityForm";

// --- Mocks de hooks (nenhuma rede) ----------------------------------------
const {
  activityQuery,
  saveWorkingHours,
  upsertOverride,
  updateValidity,
  mutateSave,
  mutateUpsert,
  mutateValidity,
} = vi.hoisted(() => ({
  activityQuery: vi.fn(),
  saveWorkingHours: vi.fn(),
  upsertOverride: vi.fn(),
  updateValidity: vi.fn(),
  mutateSave: vi.fn(async () => undefined),
  mutateUpsert: vi.fn(async () => ({})),
  mutateValidity: vi.fn(async () => ({})),
}));

vi.mock("@/hooks/useAppointments", () => ({
  useAppointmentActivityRange: (...args: unknown[]) => activityQuery(...args),
}));
vi.mock("@/hooks/useWorkingHours", () => ({
  useSaveWorkingHours: () => saveWorkingHours(),
  WORKING_HOURS_DUPLICATE_MESSAGE:
    "Já existe uma faixa para este dia. Ajuste a grade e salve novamente.",
}));
vi.mock("@/hooks/useScheduleOverrides", () => ({
  useUpsertScheduleOverride: () => upsertOverride(),
}));
vi.mock("@/hooks/useProfessionals", () => ({
  useScheduleValidity: () => ({ data: null }),
  useUpdateScheduleValidity: () => updateValidity(),
}));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ data: { timezone: "America/Sao_Paulo" } }),
}));

function baseActivity(partial: Record<string, unknown> = {}) {
  return {
    data: [],
    refetch: vi.fn(async () => ({ data: [] })),
    isFetching: false,
    ...partial,
  };
}

/** Próxima segunda-feira a partir de hoje (UTC, 14:00 BRT = 17:00Z). */
function nextMonday14Brt(): string {
  const now = new Date();
  const delta = (8 - now.getUTCDay()) % 7 || 7;
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta, 17, 0),
  );
  return d.toISOString();
}

beforeEach(() => {
  activityQuery.mockReset();
  saveWorkingHours.mockReset();
  upsertOverride.mockReset();
  updateValidity.mockReset();
  mutateSave.mockClear();
  mutateUpsert.mockClear();
  mutateValidity.mockClear();
  saveWorkingHours.mockReturnValue({
    mutateAsync: mutateSave,
    isPending: false,
  });
  upsertOverride.mockReturnValue({
    mutateAsync: mutateUpsert,
    isPending: false,
  });
  updateValidity.mockReturnValue({
    mutateAsync: mutateValidity,
    isPending: false,
  });
});

afterEach(() => cleanup());

describe("C2 — stale cache: refetch antes do check + disabled em voo", () => {
  it("OverrideFormDialog: troca dia e salva sem aguardar → refetch bloqueia com conflito", async () => {
    const conflictAppt = {
      id: "a1",
      starts_at: "2025-03-15T14:00:00.000Z", // 11:00 BRT (sábado)
      ends_at: "2025-03-15T15:00:00.000Z",
      status: "confirmado" as const,
    };
    activityQuery.mockReturnValue(
      baseActivity({
        data: [], // cache velho (dia anterior)
        refetch: vi.fn(async () => ({ data: [conflictAppt] })),
      }),
    );

    render(
      <OverrideFormDialog
        professionalId="p1"
        open
        onOpenChange={() => {}}
        override={null}
        initialDate="2025-03-15"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Salvar/ }));

    await waitFor(() =>
      expect(screen.getByText(/preservado/i)).toBeTruthy(),
    );
    expect(mutateUpsert).not.toHaveBeenCalled();
  });

  it("OverrideFormDialog: botão desabilitado enquanto busca os appointments", () => {
    activityQuery.mockReturnValue(baseActivity({ isFetching: true }));
    render(
      <OverrideFormDialog
        professionalId="p1"
        open
        onOpenChange={() => {}}
        override={null}
        initialDate="2025-03-15"
      />,
    );
    expect(
      (screen.getByRole("button", { name: /^Salvar/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("WeekScheduleForm: refetch bloqueia save com appointment fora da grade nova", async () => {
    const appt = {
      id: "a1",
      starts_at: nextMonday14Brt(), // 14:00 BRT da próxima segunda
      ends_at: new Date(
        new Date(nextMonday14Brt()).getTime() + 60 * 60 * 1000,
      ).toISOString(),
      status: "confirmado" as const,
    };
    activityQuery.mockReturnValue(
      baseActivity({
        data: [], // cache velho
        refetch: vi.fn(async () => ({ data: [appt] })),
      }),
    );

    const { container } = render(
      <WeekScheduleForm
        professionalId="p1"
        workingHours={[]}
        readOnly={false}
      />,
    );

    // Liga a segunda e deixa 09–12 BRT (14:00 fica fora → conflito).
    fireEvent.click(
      screen.getByRole("switch", { name: /Ativar atendimento em Segunda/i }),
    );
    const [start, end] = container.querySelectorAll('input[type="time"]');
    fireEvent.change(start!, { target: { value: "09:00" } });
    fireEvent.change(end!, { target: { value: "12:00" } });

    fireEvent.click(screen.getByRole("button", { name: /Salvar grade/i }));

    await waitFor(() =>
      expect(screen.getByText(/conflito com agendamento futuro/i)).toBeTruthy(),
    );
    expect(mutateSave).not.toHaveBeenCalled();
  });

  it("WeekScheduleForm: botão desabilitado enquanto busca os appointments", () => {
    activityQuery.mockReturnValue(baseActivity({ isFetching: true }));
    render(
      <WeekScheduleForm
        professionalId="p1"
        workingHours={[]}
        readOnly={false}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /Salvar grade/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("A2 — vigência passada bloqueada na tela", () => {
  it("início no passado: não salva e mostra erro pt-BR", async () => {
    activityQuery.mockReturnValue(baseActivity());

    const { container } = render(
      <ScheduleValidityForm professionalId="p1" readOnly={false} />,
    );
    const dateInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2000-01-01" } });

    fireEvent.click(screen.getByRole("button", { name: /Salvar vigência/i }));

    await waitFor(() =>
      expect(screen.getByText(/não pode ser no passado/i)).toBeTruthy(),
    );
    expect(mutateValidity).not.toHaveBeenCalled();
  });

  it("início futuro: salva normalmente", async () => {

    const { container } = render(
      <ScheduleValidityForm professionalId="p1" readOnly={false} />,
    );
    const dateInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2099-01-01" } });

    fireEvent.click(screen.getByRole("button", { name: /Salvar vigência/i }));

    await waitFor(() => expect(mutateValidity).toHaveBeenCalled());
  });
});

describe("A5 — RBAC render: leitura/bloqueado sem salvar", () => {
  it("readOnly: sem botão de salvar e switches desabilitados", () => {
    activityQuery.mockReturnValue(baseActivity());
    render(
      <WeekScheduleForm
        professionalId="p1"
        workingHours={[]}
        readOnly={true}
      />,
    );
    expect(screen.queryByRole("button", { name: /Salvar grade/i })).toBeNull();
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);
    for (const sw of switches) {
      expect((sw as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("assinatura bloqueada: sem botão de salvar", () => {
    activityQuery.mockReturnValue(baseActivity());
    render(
      <WeekScheduleForm
        professionalId="p1"
        workingHours={[]}
        readOnly={false}
        writeBlockedBySubscription
      />,
    );
    expect(screen.queryByRole("button", { name: /Salvar grade/i })).toBeNull();
  });

  it("A7: cópia de dia usa Select shadcn (sem <select> nativo)", () => {
    activityQuery.mockReturnValue(baseActivity());
    const { container } = render(
      <WeekScheduleForm
        professionalId="p1"
        workingHours={[]}
        readOnly={false}
      />,
    );
    // Radix renderiza um <select> oculto (aria-hidden, form-compat); o controle
    // visível é o trigger `combobox` (shadcn Select), sem <select> nativo visível.
    expect(container.querySelector("select:not([aria-hidden])")).toBeNull();
    expect(container.querySelector('[role="combobox"]')).toBeTruthy();
    expect(screen.getByText("Copiar dia")).toBeTruthy();
  });
});
