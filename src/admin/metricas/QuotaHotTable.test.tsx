// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { QuotaHotTable, quotaStatusOf } from "@/admin/metricas/QuotaHotTable";
import type { QuotaHotRow } from "@/hooks/usePlanTelemetry";

afterEach(() => cleanup());

function row(partial: Partial<QuotaHotRow> & { tenant_id: string }): QuotaHotRow {
  return {
    trade_name: "Empresa Quente",
    plan: "individual",
    profs: 1,
    prof_limit: 1,
    appts: 128,
    appt_limit: 150,
    month_key: "2026-11",
    ...partial,
  };
}

describe("quotaStatusOf", () => {
  it("warning ≥80, destructive ≥95", () => {
    expect(quotaStatusOf(0.85)).toBe("warning");
    expect(quotaStatusOf(0.95)).toBe("destructive");
    expect(quotaStatusOf(0.5)).toBe("ok");
    expect(quotaStatusOf(null)).toBe("ok");
  });
});

describe("QuotaHotTable", () => {
  it("85% mostra badge Atenção com ícone+texto; ordenado % desc", () => {
    render(
      <QuotaHotTable
        rows={[
          row({ tenant_id: "fria", trade_name: "Fria", profs: 0, appts: 0 }),
          row({ tenant_id: "quente", profs: 0, appts: 128 }),
        ]}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
      />,
    );
    expect(document.querySelector("tbody")?.textContent).toContain("Atenção");
    const cells = screen.getAllByText("Empresa Quente");
    expect(cells.length).toBeGreaterThan(0);
    // % desc: quente (100%) antes da fria — primeira linha do tbody é a quente.
    const rows = document.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Empresa Quente");
  });

  it("95%+ mostra badge Crítico", () => {
    render(
      <QuotaHotTable
        rows={[row({ tenant_id: "q", appts: 150 })]}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
      />,
    );
    expect(document.querySelector("tbody")?.textContent).toContain("Crítico");
  });

  it("vazio mostra estado vazio; erro mostra role=alert", () => {
    const { unmount } = render(
      <QuotaHotTable rows={[]} isLoading={false} isError={false} onRetry={() => {}} />,
    );
    expect(screen.getByText("Nenhuma empresa próxima do limite")).toBeDefined();
    unmount();
    render(<QuotaHotTable rows={[]} isLoading={false} isError onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});
