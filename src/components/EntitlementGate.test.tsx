// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntitlementGate } from "@/components/EntitlementGate";

afterEach(cleanup);

function renderGate(entitled: boolean | null) {
  return render(
    <MemoryRouter>
      <EntitlementGate entitled={entitled} recurso="Prontuário">
        <p>Dado gravado legível</p>
      </EntitlementGate>
    </MemoryRouter>,
  );
}

describe("EntitlementGate — gating só-UI (ADR-01)", () => {
  it("liberado: renderiza o conteúdo sem upsell", () => {
    renderGate(true);
    expect(screen.getByText("Dado gravado legível")).toBeDefined();
    expect(screen.queryByText(/recurso não incluído/i)).toBeNull();
  });

  it.each([false, null] as const)(
    "bloqueado (%s): mantém conteúdo legível + empty com upsell, sem crash",
    (entitled) => {
      renderGate(entitled);
      expect(screen.getByText("Dado gravado legível")).toBeDefined();
      expect(screen.getByText(/recurso não incluído/i)).toBeDefined();
      const cta = screen.getByRole("link", { name: /ver planos/i });
      expect(cta.getAttribute("href")).toBe("/precos");
    },
  );

  it("ação bloqueada usa botão desabilitado com explicação acessível", () => {
    renderGate(false);
    const botao = screen.getByRole("button", { name: /novo registro/i });
    expect(botao.hasAttribute("disabled")).toBe(true);
    const descricaoId = botao.getAttribute("aria-describedby");
    expect(descricaoId).toBeTruthy();
    expect(document.getElementById(descricaoId ?? "")?.textContent).toMatch(
      /plano atual/i,
    );
  });

  it("não dispara nenhum request de rede ao renderizar bloqueado", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sem rede"));
    try {
      renderGate(null);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
