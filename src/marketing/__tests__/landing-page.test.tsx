// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/shadcn/dashboard/section-cards", () => ({
  SectionCards: () => <div>Painel de métricas Atlas Agenda</div>,
}));
vi.mock("@/components/shadcn/scheduler/scheduler", () => ({
  Scheduler: () => <div>Grade da agenda Atlas Agenda</div>,
}));
vi.mock("@/components/shadcn/kanban/kanban-board", () => ({
  KanbanBoard: () => <div>Quadro Kanban Atlas Agenda</div>,
}));

import { ThemeProvider } from "@/components/ThemeProvider";
import { LandingPage } from "@/marketing/pages";

// happy-dom neste projeto não expõe localStorage por padrão.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  },
});

afterEach(cleanup);

function renderLanding() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("LandingPage — layout do template admin", () => {
  it("usa links do React Router (sem hash router) nos CTAs", () => {
    renderLanding();
    const cadastro = screen.getAllByRole("link", { name: /começar agora|acessar plataforma/i });
    expect(cadastro.length).toBeGreaterThan(0);
    for (const link of cadastro) {
      expect(link.getAttribute("href")).toBe("/cadastro");
    }
    const planos = screen.getAllByRole("link", { name: /ver planos|ver todos os planos/i });
    for (const link of planos) {
      expect(link.getAttribute("href")).toBe("/precos");
    }
    expect(screen.getByRole("link", { name: "Entrar" }).getAttribute("href")).toBe("/login");
    expect(document.body.innerHTML).not.toContain("#/");
  });

  it("renderiza navbar sticky, nav sections, hero e footer do template", () => {
    const { container } = renderLanding();
    for (const label of ["Recursos", "Operações", "Planos", "Depoimentos", "FAQ"]) {
      expect(screen.getByRole("link", { name: label }).getAttribute("href")).toMatch(/^#/);
    }
    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    expect(screen.getByText(/Confiado por barbearias|Confiado por clínicas/i)).toBeDefined();
    expect(screen.getByText(/© \d{4} Atlas Agenda/)).toBeDefined();
    expect(container.querySelector("header.sticky")).not.toBeNull();
  });

  it("troca o showcase interativo entre KPI, agenda e Kanban", () => {
    renderLanding();
    expect(screen.getByText("Painel de métricas Atlas Agenda")).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: /agenda da equipe/i }));
    expect(screen.getByText("Grade da agenda Atlas Agenda")).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: /quadro kanban/i }));
    expect(screen.getByText("Quadro Kanban Atlas Agenda")).toBeDefined();
  });

  it("usa Accordion do template para a FAQ", () => {
    renderLanding();
    const trigger = screen.getByText(/Preciso instalar algo/i);
    expect(trigger).toBeDefined();
    fireEvent.click(trigger);
    expect(screen.getByText(/roda no navegador do celular/i)).toBeDefined();
  });

  it("mantém os 3 painéis no DOM e alterna hidden com aria-controls válido", () => {
    const { container } = renderLanding();
    const panels = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    expect(panels()).toHaveLength(3);
    expect(panels().map((panel) => panel.hidden)).toEqual([false, true, true]);

    for (const tab of screen.getAllByRole("tab")) {
      const controlled = tab.getAttribute("aria-controls");
      expect(controlled).toBeTruthy();
      expect(container.querySelector(`#${controlled}`)).not.toBeNull();
    }

    fireEvent.click(screen.getByRole("tab", { name: /quadro kanban/i }));
    expect(panels().map((panel) => panel.hidden)).toEqual([true, true, false]);
  });

  it("navega o tablist com roving tabindex, setas e Home/End", () => {
    renderLanding();
    const tabs = () => screen.getAllByRole("tab");
    expect(tabs().map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

    tabs()[0]?.focus();
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight" });
    expect(tabs()[1]?.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(tabs()[1]);
    expect(screen.getByText("Grade da agenda Atlas Agenda")).toBeDefined();

    fireEvent.keyDown(tabs()[1]!, { key: "End" });
    expect(tabs()[2]?.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(tabs()[2]);

    fireEvent.keyDown(tabs()[2]!, { key: "ArrowRight" });
    expect(tabs()[0]?.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(tabs()[0]);

    fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
    expect(tabs()[2]?.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(tabs()[2]);

    fireEvent.keyDown(tabs()[2]!, { key: "Home" });
    expect(tabs()[0]?.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("todas as âncoras da navegação principal resolvem para uma seção real", () => {
    const { container } = renderLanding();
    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    for (const link of within(nav).getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(href, link.textContent ?? "").toMatch(/^#[a-z-]+$/);
      const target = container.querySelector<HTMLElement>(href);
      expect(target, href).not.toBeNull();
      // Alvo deve ser conteúdo da página, não mero âncora no rodapé.
      expect(target?.closest("footer"), `${href} aponta só para o footer`).toBeNull();
      expect(target?.matches("section, [role='region']"), href).toBe(true);
    }
  });
});
