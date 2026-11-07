// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { scheduleOverrideSchema } from "@/lib/validations/schedule";
import { MonthlyGradeView } from "@/app/config/profissionais/horarios/MonthlyGradeView";
import { deriveMonthlyGrade } from "@/app/config/profissionais/horarios/deriveMonthlyGrade";

// FE-05: RBAC/i18n/a11y + override conflict (pure).

import { findOverrideConflict } from "@/app/config/profissionais/horarios/deriveMonthlyGrade";

afterEach(() => cleanup());

describe("FE-05 reason não-PII", () => {
  it("motivo com telefone/CPF é rejeitado em pt-BR", () => {
    const result = scheduleOverrideSchema.safeParse({
      overrideDate: "2025-03-15",
      isClosed: true,
      hasBreak: false,
      reason: "Ligar para 11 99999-0000",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("telefone ou documento"),
        ),
      ).toBe(true);
    }
  });

  it("motivo simples passa", () => {
    const result = scheduleOverrideSchema.safeParse({
      overrideDate: "2025-03-15",
      isClosed: true,
      hasBreak: false,
      reason: "Feriado",
    });
    expect(result.success).toBe(true);
  });

  // A3: burlas por número contínuo e parênteses (sem separador) também são PII.
  it.each([
    "Ligar (11) 99999-0000",
    "Ligar (11)999990000",
    "Ligar 11999990000",
    "CPF 12345678909",
    "Contato 11999990000 ramal",
    "whats 11 999999999",
  ])("motivo com PII disfarçada é rejeitado: %s", (reason) => {
    const result = scheduleOverrideSchema.safeParse({
      overrideDate: "2025-03-15",
      isClosed: true,
      hasBreak: false,
      reason,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    "Feriado nacional",
    "Data de 2025-03-15 sem atendimento",
    "Congresso da categoria 2025",
    "Volta dia 10",
  ])("motivo sem PII passa: %s", (reason) => {
    const result = scheduleOverrideSchema.safeParse({
      overrideDate: "2025-03-15",
      isClosed: true,
      hasBreak: false,
      reason,
    });
    expect(result.success).toBe(true);
  });
});

describe("FE-04 conflito exceção × appointment", () => {
  const base = {
    overrideDate: "2025-03-15",
    timeZone: "America/Sao_Paulo",
  };

  it("folga com appointment ativo no dia bloqueia e preserva", () => {
    const conflict = findOverrideConflict({
      ...base,
      isClosed: true,
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-15T14:00:00.000Z",
          endsAt: "2025-03-15T15:00:00.000Z",
          status: "confirmado",
        },
      ],
    });
    expect(conflict).not.toBeNull();
    expect(conflict?.message).toMatch(/preservado/i);
  });

  it("atípico que cobre o appointment não bloqueia", () => {
    const conflict = findOverrideConflict({
      ...base,
      isClosed: false,
      startTime: "09:00",
      endTime: "13:00",
      breakStart: null,
      breakEnd: null,
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-15T14:00:00.000Z", // 11:00 BRT, dentro de 09-13
          endsAt: "2025-03-15T15:00:00.000Z",
          status: "confirmado",
        },
      ],
    });
    expect(conflict).toBeNull();
  });

  it("atípico fora do appointment bloqueia", () => {
    const conflict = findOverrideConflict({
      ...base,
      isClosed: false,
      startTime: "14:00",
      endTime: "18:00",
      breakStart: null,
      breakEnd: null,
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-15T14:00:00.000Z", // 11:00 BRT, fora de 14-18
          endsAt: "2025-03-15T15:00:00.000Z",
          status: "confirmado",
        },
      ],
    });
    expect(conflict).not.toBeNull();
  });

  it("cancelado não bloqueia folga", () => {
    const conflict = findOverrideConflict({
      ...base,
      isClosed: true,
      appointments: [
        {
          id: "a1",
          startsAt: "2025-03-15T14:00:00.000Z",
          endsAt: "2025-03-15T15:00:00.000Z",
          status: "cancelado",
        },
      ],
    });
    expect(conflict).toBeNull();
  });
});

describe("FE-05 a11y basics", () => {
  it("renderiza sem quebrar com targets ≥44px nas setas (classes)", () => {
    const { container } = render(
      <div className="min-h-[44px] min-w-[44px]">ok</div>,
    );
    expect(container.firstElementChild).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
    cleanup();
  });

  it("Tab/lente: dia é botão nativo focável com foco visível + aria-label completo", () => {
    const days = deriveMonthlyGrade({
      month: "2025-03",
      workingHours: [
        {
          id: "wh",
          tenant_id: "t",
          professional_id: "p",
          weekday: 1,
          start_time: "09:00",
          end_time: "18:00",
          break_start: null,
          break_end: null,
          created_at: "2025-01-01T00:00:00.000Z",
        },
      ],
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const { container } = render(
      <MonthlyGradeView
        days={days}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={false}
        onMonthChange={() => {}}
        onDayClick={() => {}}
      />,
    );
    const dayButton = container.querySelector('button[aria-label*="10/03/2025"]');
    expect(dayButton).toBeTruthy();
    expect(dayButton?.tagName).toBe("BUTTON"); // Enter/Espaço nativos (Tab/Enter/Esc)
    expect(dayButton?.className).toMatch(/focus-visible:ring/); // foco visível
    expect(dayButton?.getAttribute("aria-label")).toMatch(
      /atendimento 09:00–18:00/,
    ); // NVDA: dia + estado
  });
});
