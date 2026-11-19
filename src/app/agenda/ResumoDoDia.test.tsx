// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResumoDoDia } from "@/app/agenda/ResumoDoDia";
import type { MaskedDaySummary } from "@/app/agenda/model/financialMask";

const SUMMARY: MaskedDaySummary = {
  ocupacaoPct: 50,
  horariosOcupados: 10,
  capacidade: 20,
  previstoCents: 4500,
  numAtendimentos: 2,
  aConfirmar: 3,
  riscoNoShow: 1,
};

const MASKED: MaskedDaySummary = { ...SUMMARY, previstoCents: null };

function renderResumo(overrides: Partial<Parameters<typeof ResumoDoDia>[0]> = {}) {
  const props = {
    summary: SUMMARY,
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    onSelectTodos: vi.fn(),
    onSelectAConfirmar: vi.fn(),
    aConfirmarAtivo: false,
    ...overrides,
  };
  render(<ResumoDoDia {...props} />);
  return props;
}

afterEach(cleanup);

describe("ResumoDoDia (ADR-02)", () => {
  it("renderiza os 4 KPIs com a fixture da ADR-01", () => {
    renderResumo();
    expect(screen.getByText("Ocupação")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("10 de 20 horários")).toBeTruthy();
    expect(screen.getByText("Previsto")).toBeTruthy();
    expect(screen.getByText("R$ 45,00")).toBeTruthy();
    expect(screen.getByText("2 atendimentos")).toBeTruthy();
    expect(screen.getByText("A confirmar")).toBeTruthy();
    expect(screen.getByText("Risco no-show")).toBeTruthy();
  });

  it("clique em 'A confirmar' seleciona filterStatus=pendente", () => {
    const props = renderResumo();
    fireEvent.click(screen.getByRole("button", { name: /A confirmar/ }));
    expect(props.onSelectAConfirmar).toHaveBeenCalledTimes(1);
    expect(props.onSelectTodos).not.toHaveBeenCalled();
  });

  it("clique em 'Ocupação' e 'Previsto' mostra todos (limpa filtro)", () => {
    const props = renderResumo();
    fireEvent.click(screen.getByRole("button", { name: /Ocupação/ }));
    fireEvent.click(screen.getByRole("button", { name: /Previsto/ }));
    expect(props.onSelectTodos).toHaveBeenCalledTimes(2);
  });

  it("ativa por teclado (Enter) no card de risco", () => {
    const props = renderResumo();
    fireEvent.keyDown(screen.getByRole("button", { name: /Risco no-show/ }), {
      key: "Enter",
    });
    expect(props.onSelectAConfirmar).toHaveBeenCalledTimes(1);
  });

  it("receptionist (mascarado): nenhum 'R$' no resumo, '—' sem valor", () => {
    const { container } = (() => {
      const props = {
        summary: MASKED,
        isLoading: false,
        isError: false,
        onRetry: vi.fn(),
        onSelectTodos: vi.fn(),
        onSelectAConfirmar: vi.fn(),
        aConfirmarAtivo: false,
      };
      const result = render(<ResumoDoDia {...props} />);
      return { container: result.container };
    })();
    expect(container.querySelectorAll("*").length).toBeGreaterThan(0);
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("marca 'A confirmar' com aria-pressed quando o filtro está ativo", () => {
    renderResumo({ aConfirmarAtivo: true });
    expect(
      screen.getByRole("button", { name: /A confirmar/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("carregando: skeleton com aria-busy, sem KPIs", () => {
    renderResumo({ summary: null, isLoading: true });
    expect(screen.getByTestId("resumo-do-dia-loading").getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.queryByText("Ocupação")).toBeNull();
  });

  it("erro: painel com 'Tentar novamente' que chama onRetry", () => {
    const props = renderResumo({ summary: null, isError: true });
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("sem capacidade: degrada para 'N agendados' sem %", () => {
    renderResumo({
      summary: { ...SUMMARY, ocupacaoPct: null, capacidade: null },
    });
    expect(screen.getByText("10 agendados")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
