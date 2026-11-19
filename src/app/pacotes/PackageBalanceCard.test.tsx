// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PackageBalanceCard } from "@/app/pacotes/PackageBalanceCard";
import type { PackageBalance } from "@/types/domain";

afterEach(cleanup);

function balance(overrides: Partial<PackageBalance> = {}): PackageBalance {
  return {
    credit_id: "cr-1",
    service_id: "s-1",
    total_sessions: 5,
    used_sessions: 2,
    remaining: 3,
    expires_at: "2026-12-31T12:00:00.000Z",
    expired: false,
    status: "active",
    ...overrides,
  };
}

describe("PackageBalanceCard — T3 (ADR-06)", () => {
  it("mostra X de Y + progressbar com aria-values e texto %", () => {
    render(
      <PackageBalanceCard
        balance={balance()}
        serviceName="Limpeza de pele"
        priceCents={60000}
        canSeePrice
      />,
    );
    expect(screen.getByText(/3 de 5 restantes/)).toBeDefined();
    const bar = screen.getByRole("progressbar", {
      name: "Saldo restante do pacote",
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(screen.getByText("60% restante")).toBeDefined();
  });

  it("recepção vê só N restantes, sem preço", () => {
    const { container } = render(
      <PackageBalanceCard
        balance={balance()}
        serviceName="Limpeza de pele"
        priceCents={60000}
        canSeePrice={false}
      />,
    );
    expect(screen.getByText(/3 de 5 restantes/)).toBeDefined();
    expect(container.textContent).not.toMatch(/R\$/);
    expect(container.textContent).not.toMatch(/Valor do pacote/);
  });

  it("admin vê o valor do pacote", () => {
    render(
      <PackageBalanceCard
        balance={balance()}
        priceCents={60000}
        canSeePrice
      />,
    );
    expect(screen.getByText(/Valor do pacote/)).toBeDefined();
  });

  it("vencido mostra badge + Renovar", () => {
    const onRenew = vi.fn();
    render(
      <PackageBalanceCard
        balance={balance({ expired: true, remaining: 2, status: "active" })}
        canSeePrice
        onRenew={onRenew}
      />,
    );
    expect(screen.getByText("Vencido")).toBeDefined();
    const renew = screen.getByRole("button", { name: /renovar/i });
    fireEvent.click(renew);
    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("progressbar", { name: "Saldo restante do pacote" }),
    ).toBeNull();
  });

  it("saldo zero bloqueia e oferece avulso", () => {
    const onBuySingle = vi.fn();
    render(
      <PackageBalanceCard
        balance={balance({ used_sessions: 5, remaining: 0, status: "exhausted" })}
        canSeePrice
        onBuySingle={onBuySingle}
      />,
    );
    expect(screen.getByText("Esgotado")).toBeDefined();
    expect(screen.getByText(/saldo chegou a zero/i)).toBeDefined();
    const avulso = screen.getByRole("button", { name: /avulsa/i });
    fireEvent.click(avulso);
    expect(onBuySingle).toHaveBeenCalledTimes(1);
  });
});
