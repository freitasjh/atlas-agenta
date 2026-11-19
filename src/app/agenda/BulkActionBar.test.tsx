// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkActionBar } from "@/app/agenda/BulkActionBar";

afterEach(cleanup);

function baseProps(overrides = {}) {
  return {
    selectedCount: 3,
    canManage: true,
    running: false,
    progress: null,
    result: null,
    onConfirm: vi.fn(),
    onCancelRequest: vi.fn(),
    onRetry: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

describe("BulkActionBar — barra de lote (ADR-04)", () => {
  it("anuncia a contagem e oferece Confirmar N / Cancelar N", () => {
    render(<BulkActionBar {...baseProps()} />);
    expect(screen.getByText("3 selecionados")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Confirmar 3 agendamentos" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cancelar 3 agendamentos" }),
    ).toBeTruthy();
  });

  it("RBAC: sem canManage não renderiza ações", () => {
    render(<BulkActionBar {...baseProps({ canManage: false })} />);
    expect(
      screen.queryByRole("button", { name: /Confirmar/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancelar/ })).toBeNull();
  });

  it("Cancelamento pede confirmação via onCancelRequest (não dispara direto)", () => {
    const props = baseProps();
    render(<BulkActionBar {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar 3 agendamentos" }),
    );
    expect(props.onCancelRequest).toHaveBeenCalledOnce();
  });

  it("Confirmar dispara direto sem diálogo", () => {
    const props = baseProps();
    render(<BulkActionBar {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar 3 agendamentos" }),
    );
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it("progresso usa progressbar e resumo parcial usa aria-live com retry só dos falhos", () => {
    const props = baseProps({
      running: false,
      progress: { done: 3, total: 3 },
      result: {
        ok: [{ id: "a", from: "pendente" }],
        failed: [
          { item: { id: "b", from: "pendente" }, error: new Error("x") },
          { item: { id: "c", from: "pendente" }, error: new Error("y") },
        ],
      },
    });
    render(<BulkActionBar {...props} />);
    const bar = screen.getByRole("progressbar", { name: /lote/i });
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    expect(screen.getByText("1 ok, 2 falharam")).toBeTruthy();
    const retry = screen.getByRole("button", {
      name: "Repetir 2 com falha",
    });
    fireEvent.click(retry);
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it("sem Desfazer: lote irreversível não oferece undo mesmo após sucesso", () => {
    render(
      <BulkActionBar
        {...baseProps({
          result: {
            ok: [
              { id: "a", from: "pendente" },
              { id: "b", from: "pendente" },
            ],
            failed: [],
          },
        })}
      />,
    );
    expect(screen.getByText("2 ok, 0 falharam")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Desfazer/ })).toBeNull();
  });
});
