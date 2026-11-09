// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PlanAnalyticsCardView } from "@/internal-admin/metricas/PlanAnalyticsCard";

afterEach(() => cleanup());

describe("PlanAnalyticsCardView", () => {
  it("mostra conversão e churn por plano", () => {
    render(
      <PlanAnalyticsCardView
        conversion={{ coorte: 10, convertidos: 4, taxa: 40 }}
        churn={{ by_plan: { individual: { base: 5, churned: 1, taxa: 20 } } }}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("40,0%")).toBeDefined();
    expect(screen.getByText(/4 de 10 trials convertidos/)).toBeDefined();
    expect(screen.getByText("Individual")).toBeDefined();
  });

  it("denominador 0 mostra — com apoio (nunca 0%/NaN)", () => {
    render(
      <PlanAnalyticsCardView
        conversion={{ coorte: 0, convertidos: 0, taxa: null }}
        churn={{ by_plan: {} }}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByLabelText("Conversão sem coorte").textContent).toBe("—");
    expect(screen.getByText("Sem coorte no período")).toBeDefined();
    expect(screen.getByText("Sem base no mês")).toBeDefined();
  });

  it("erro mostra role=alert + retry", () => {
    const onRetry = vi.fn();
    render(
      <PlanAnalyticsCardView
        conversion={null}
        churn={null}
        isLoading={false}
        isError
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeDefined();
    screen.getByText("Tentar novamente").click();
    expect(onRetry).toHaveBeenCalled();
  });
});
