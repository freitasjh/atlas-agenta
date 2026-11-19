// @vitest-environment happy-dom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DepositConfigSection } from "@/app/config/servicos/DepositConfigSection";
import {
  EMPTY_DEPOSIT_CONFIG,
  type DepositConfigInput,
} from "@/lib/validations/deposit";

afterEach(cleanup);

function renderSection(
  entitled: boolean | null,
  initial: DepositConfigInput = EMPTY_DEPOSIT_CONFIG,
) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <DepositConfigSection
        entitled={entitled}
        value={value}
        onChange={setValue}
      />
    );
  }
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

describe("DepositConfigSection — ADR-12 / RF-01", () => {
  it.each([false, null] as const)(
    "sem entitlement (%s): seção invisível + upsell, sem campos",
    (entitled) => {
      renderSection(entitled);
      expect(
        screen.getByText(/depósito\/sinal/i).textContent,
      ).toBeTruthy();
      expect(
        screen.queryByLabelText(/exigir depósito/i),
      ).toBeNull();
      const cta = screen.getByRole("link", { name: /ver planos/i });
      expect(cta.getAttribute("href")).toBe("/precos");
    },
  );

  it("com entitlement: toggle liga e exibe tipo, prazo e reembolso", () => {
    renderSection(true);
    const toggle = screen.getByRole("switch", {
      name: /exigir depósito/i,
    });
    fireEvent.click(toggle);
    expect(
      screen.getByLabelText(/tipo de depósito/i),
    ).toBeDefined();
    expect(
      screen.getByLabelText(/prazo para pagar/i),
    ).toBeDefined();
    expect(
      screen.getByLabelText(/política de reembolso/i),
    ).toBeDefined();
  });

  it("não dispara nenhum request de rede ao renderizar", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("sem rede"),
    );
    try {
      renderSection(null);
      expect(screen.getByRole("link", { name: /ver planos/i })).toBeDefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
