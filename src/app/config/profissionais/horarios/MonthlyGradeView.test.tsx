// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MonthlyGradeView } from "@/app/config/profissionais/horarios/MonthlyGradeView";
import { deriveMonthlyGrade } from "@/app/config/profissionais/horarios/deriveMonthlyGrade";
import type { WorkingHour } from "@/types/domain";

afterEach(() => cleanup());

function grade(): WorkingHour[] {
  return [
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
  ];
}

function days() {
  return deriveMonthlyGrade({
    month: "2025-03",
    workingHours: grade(),
    overrides: [],
    scheduleStartDate: null,
    scheduleEndDate: null,
  });
}

describe("MonthlyGradeView", () => {
  it("badge textual GRADE + legenda + navegação de mês", () => {
    render(
      <MonthlyGradeView
        days={days()}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={false}
        onMonthChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("GRADE").length).toBeGreaterThan(0);
    expect(screen.getByText(/grade semanal do dia/)).toBeTruthy();
    expect(screen.getByLabelText(/Mês anterior/)).toBeTruthy();
    expect(screen.getByLabelText(/Próximo mês/)).toBeTruthy();
  });

  it("TESTE NEGATIVO: nenhuma célula edita grade (sem input/textarea/select)", () => {
    const { container } = render(
      <MonthlyGradeView
        days={days()}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("select")).toBeNull();
  });

  it("aria-label de dia completo em pt-BR (dia + estado)", () => {
    const { container } = render(
      <MonthlyGradeView
        days={days()}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    const cell = container.querySelector('[aria-label*="10/03/2025"]');
    expect(cell).toBeTruthy();
    expect(cell?.getAttribute("aria-label")).toMatch(/atendimento 09:00–18:00/);
  });

  it("C1: blanks alinham o dia 1 à coluna do weekday (março/2025 começa sábado)", () => {
    // 2025-03-01 é sábado. Ordem seg→dom: 5 blanks (seg..sex) antes do dia 1.
    const { container } = render(
      <MonthlyGradeView
        days={days()}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    const blanks = container.querySelectorAll("[data-blank-cell]");
    expect(blanks).toHaveLength(5);
    // 31 dias do mês + 5 blanks nas 7 colunas.
    const cells = container.querySelectorAll("[data-day-cell]");
    expect(cells).toHaveLength(31);
  });

  it("C1: mês que começa segunda não tem blanks (abril/2025 = terça → 1 blank)", () => {
    const dias = deriveMonthlyGrade({
      month: "2025-04",
      workingHours: grade(),
      overrides: [],
      scheduleStartDate: null,
      scheduleEndDate: null,
    });
    const { container } = render(
      <MonthlyGradeView
        days={dias}
        month="2025-04"
        validityLabel="sem início · sem término"
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-blank-cell]")).toHaveLength(1);
  });

  it("C1: sem min-w nem scroll horizontal; 7 colunas flexíveis", () => {
    const { container } = render(
      <MonthlyGradeView
        days={days()}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    expect(container.querySelector('[class*="min-w-[560px]"]')).toBeNull();
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
    const list = container.querySelector("ul.grid-cols-7");
    expect(list).toBeTruthy();
    expect(list?.className).toMatch(/grid-cols-7/);
    expect(container.querySelector('[role="grid"]')).toBeNull();
  });

  it("C1: semântica lista + botão real (sem role sobrescrevendo button)", () => {
    const { container } = render(
      <MonthlyGradeView
        days={days()}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={false}
        onMonthChange={vi.fn()}
        onDayClick={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll("li[data-day-cell] button");
    expect(buttons.length).toBeGreaterThan(0);
    // Nenhum botão com role alternativo (button de verdade é o único caminho
    // de exceção via Dialog).
    for (const button of buttons) {
      expect(button.getAttribute("role")).toBeNull();
    }
    expect(container.querySelector('[role="gridcell"]')).toBeNull();
    expect(container.querySelector('[role="columnheader"]')).toBeNull();
  });

  it("C1: leitura (readOnly) = lista <li>, sem botão de dia", () => {
    const { container } = render(
      <MonthlyGradeView
        days={days()}
        month="2025-03"
        validityLabel="sem início · sem término"
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("li[data-day-cell]").length).toBeGreaterThan(0);
    expect(container.querySelector("button[data-day-cell]")).toBeNull();
  });

  it("Skeleton/Empty/Error: loading, vazio e erro com retry", () => {
    const { rerender } = render(
      <MonthlyGradeView
        days={[]}
        month="2025-03"
        validityLabel="sem início"
        isLoading
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Carregando calendário/)).toBeTruthy();

    rerender(
      <MonthlyGradeView
        days={[]}
        month="2025-03"
        validityLabel="sem início"
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nenhum dia para exibir/)).toBeTruthy();

    rerender(
      <MonthlyGradeView
        days={[]}
        month="2025-03"
        validityLabel="sem início"
        isError
        onRetry={vi.fn()}
        readOnly={true}
        onMonthChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Tentar novamente/)).toBeTruthy();
  });
});
