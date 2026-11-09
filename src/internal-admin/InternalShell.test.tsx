// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { InternalShell } from "@/internal-admin/InternalShell";

function renderShell(entry = "/internal-admin/empresas") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<InternalShell />}>
          <Route
            path="/internal-admin/empresas"
            element={<h1>Empresas</h1>}
          />
          <Route
            path="/internal-admin/convites"
            element={<h1>Convites</h1>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

afterEach(() => cleanup());

describe("InternalShell", () => {
  it("monta grade 16rem/1fr com sidebar sob aria-label e conteúdo max-w-5xl", () => {
    const { container } = renderShell();
    const shell = container.querySelector(".md\\:grid-cols-\\[16rem_1fr\\]");
    expect(shell).toBeTruthy();
    expect(container.querySelector("aside[aria-label='Administração interna']")).toBeTruthy();
    expect(container.querySelector("main.max-w-5xl")).toBeTruthy();
  });

  it("expõe skip-link e 6 links + Sair", () => {
    renderShell();
    expect(screen.getByText("Pular para o conteúdo")).toBeTruthy();
    for (const [label, href] of [
      ["Empresas", "/internal-admin/empresas"],
      ["Assinaturas", "/internal-admin/assinaturas"],
      ["Métricas", "/internal-admin/metricas"],
      ["Dashboard", "/internal-admin/dashboard"],
      ["Convites", "/internal-admin/convites"],
      ["Auditoria", "/internal-admin/auditoria"],
    ] as const) {
      const link = screen.getByRole("link", { name: new RegExp(label) });
      expect(link.getAttribute("href")).toBe(href);
    }
    expect(screen.getByRole("button", { name: /sair/i })).toBeTruthy();
  });

  it("Sair tem altura mínima de toque (44px)", () => {
    renderShell();
    const sair = screen.getByRole("button", { name: /sair/i });
    expect(sair.className).toContain("min-h-[44px]");
  });

  it("move o foco para o h1 a cada rota", () => {
    const { unmount } = renderShell("/internal-admin/empresas");
    expect(document.activeElement?.textContent).toBe("Empresas");
    unmount();
    renderShell("/internal-admin/convites");
    expect(document.activeElement?.textContent).toBe("Convites");
  });
});
