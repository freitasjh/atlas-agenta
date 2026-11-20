// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeProvider } from "@/components/ThemeProvider";
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle";

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

describe("ModeToggle integrado ao ThemeProvider", () => {
  beforeEach(() => {
    store.clear();
    document.documentElement.classList.remove("dark");
  });

  it("alterna a classe dark e o rótulo acessível", () => {
    render(
      <ThemeProvider>
        <ModeToggle />
      </ThemeProvider>,
    );

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toBe("Ativar tema claro");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fireEvent.click(button);

    expect(button.getAttribute("aria-label")).toBe("Ativar tema escuro");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
