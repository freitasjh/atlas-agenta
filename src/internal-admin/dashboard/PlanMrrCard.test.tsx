// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PlanMrrCardView } from "@/internal-admin/dashboard/PlanMrrCard";

afterEach(() => cleanup());

describe("PlanMrrCardView", () => {
  it("mostra MRR pt-BR tabular e mix por plano", () => {
    render(
      <PlanMrrCardView
        mrr={{
          mrr_cents: 5900 + 14900,
          base_ativa: 2,
          by_plan: {
            individual: { base: 1, mrr_cents: 5900 },
            clinica: { base: 1, mrr_cents: 14900 },
          },
        }}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        month="2026-11"
      />,
    );
    expect(screen.getByText(/208,00/)).toBeDefined();
    expect(screen.getByText(/2 empresas pagantes/)).toBeDefined();
    expect(screen.getByText(/Ver empresas próximas do limite/)).toBeDefined();
  });

  it("zero pagantes mostra — + Sem pagantes (nunca R$0 falso)", () => {
    render(
      <PlanMrrCardView
        mrr={{ mrr_cents: 0, base_ativa: 0, by_plan: {} }}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        month="2026-11"
      />,
    );
    expect(screen.getByLabelText("MRR sem pagantes").textContent).toBe("—");
    expect(screen.getByText("Sem pagantes")).toBeDefined();
  });

  it("erro mostra role=alert + retry", () => {
    const onRetry = vi.fn();
    render(
      <PlanMrrCardView
        mrr={null}
        isLoading={false}
        isError
        onRetry={onRetry}
        month="2026-11"
      />,
    );
    expect(screen.getByRole("alert")).toBeDefined();
    screen.getByText("Tentar novamente").click();
    expect(onRetry).toHaveBeenCalled();
  });
});
