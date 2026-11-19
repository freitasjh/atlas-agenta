// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgendaFilterChips } from "@/app/agenda/AgendaFilterChips";

afterEach(cleanup);

describe("AgendaFilterChips (ADR-02)", () => {
  it("renderiza chips removíveis com rótulos pt-BR", () => {
    const onRemove = vi.fn();
    render(
      <AgendaFilterChips
        chips={[
          { key: "status", rotulo: "Pendente" },
          { key: "servico", rotulo: "Corte" },
        ]}
        onRemove={onRemove}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.getByText("Pendente")).toBeTruthy();
    expect(screen.getByText("Corte")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Pendente" }));
    expect(onRemove).toHaveBeenCalledWith("status");
  });

  it("'Limpar tudo (N)' zera os filtros com a contagem no rótulo", () => {
    const onClearAll = vi.fn();
    render(
      <AgendaFilterChips
        chips={[
          { key: "status", rotulo: "Pendente" },
          { key: "servico", rotulo: "Corte" },
        ]}
        onRemove={vi.fn()}
        onClearAll={onClearAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Limpar tudo (2)" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("sem filtros ativos não renderiza nada", () => {
    const { container } = render(
      <AgendaFilterChips chips={[]} onRemove={vi.fn()} onClearAll={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
