// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkStatusConfirm } from "@/app/agenda/BulkStatusConfirm";

afterEach(cleanup);

describe("BulkStatusConfirm — confirmação única do lote (ADR-04)", () => {
  it("cancelar exige confirmação explícita com a contagem", () => {
    const onConfirm = vi.fn();
    render(
      <BulkStatusConfirm
        open
        count={4}
        confirming={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByText(/4 agendamentos serão cancelados/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar 4 agendamentos" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith();
  });

  it("declara irreversibilidade (sem Desfazer após o lote)", () => {
    render(
      <BulkStatusConfirm
        open
        count={2}
        confirming={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/não poderá ser desfeita/)).toBeTruthy();
  });

  it("fechado não renderiza conteúdo", () => {
    render(
      <BulkStatusConfirm
        open={false}
        count={2}
        confirming={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Cancelar 2 agendamentos/ }),
    ).toBeNull();
  });
});
