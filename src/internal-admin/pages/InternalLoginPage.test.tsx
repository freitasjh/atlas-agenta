// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InternalLoginPage } from "@/internal-admin/pages/InternalLoginPage";
import { GENERIC_LOGIN_ERROR } from "@/internal-admin/internalOperator";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
    },
  },
}));

import { supabase } from "@/lib/supabase";

const signIn = supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <InternalLoginPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InternalLoginPage", () => {
  it("erro genérico anti-enumeração com role=alert", async () => {
    signIn.mockResolvedValue({ error: new Error("bad") });
    renderPage();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "alguem@x.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "errada" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(GENERIC_LOGIN_ERROR);
  });

  it("tem 1 primário e CTA com altura mínima", () => {
    renderPage();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].className).toContain("min-h-[44px]");
  });
});
