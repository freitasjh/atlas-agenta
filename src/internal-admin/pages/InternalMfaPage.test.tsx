// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InternalMfaPage } from "@/internal-admin/pages/InternalMfaPage";
import { MFA_PENDING_KEY } from "@/internal-admin/internalOperator";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      mfa: {
        listFactors: vi.fn(),
        challenge: vi.fn(),
        verify: vi.fn(),
      },
    },
  },
}));

import { supabase } from "@/lib/supabase";

const listFactors = supabase.auth.mfa.listFactors as unknown as ReturnType<typeof vi.fn>;
const challenge = supabase.auth.mfa.challenge as unknown as ReturnType<typeof vi.fn>;
const verify = supabase.auth.mfa.verify as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <InternalMfaPage />
    </MemoryRouter>,
  );
}

function renderWithRoutes() {
  return render(
    <MemoryRouter initialEntries={["/internal-admin/mfa"]}>
      <Routes>
        <Route path="/internal-admin/mfa" element={<InternalMfaPage />} />
        <Route path="/internal-admin/login" element={<p>Login interno</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockMfaFlow(verifyError: unknown = null) {
  listFactors.mockResolvedValue({
    data: { totp: [{ id: "factor-1", status: "verified" }] },
    error: null,
  });
  challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
  verify.mockResolvedValue({ error: verifyError });
}

beforeEach(() => {
  sessionStorage.setItem(MFA_PENDING_KEY, String(Date.now()));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("InternalMfaPage", () => {
  it("OTP usa input numérico com one-time-code e tabular-nums", () => {
    mockMfaFlow();
    renderPage();
    const input = screen.getByLabelText("Código de 6 dígitos");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.className).toContain("tabular-nums");
  });

  it("código inválido mostra restantes com role=alert", async () => {
    mockMfaFlow(new Error("invalid"));
    renderPage();
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar código" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Restam 4 tentativas");
  });

  it("5 tentativas disparam lockout com timer", async () => {
    mockMfaFlow(new Error("invalid"));
    renderPage();
    for (let i = 0; i < 5; i += 1) {
      fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
      fireEvent.click(screen.getByRole("button", { name: "Verificar código" }));
      await screen.findByRole("alert");
    }
    expect(await screen.findByText(/Aguarde 5 minutos/)).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("mfa_pending expirado redireciona ao login e limpa o carimbo", async () => {
    mockMfaFlow();
    sessionStorage.setItem(MFA_PENDING_KEY, String(Date.now() - 11 * 60 * 1000));
    renderWithRoutes();
    expect(await screen.findByText("Login interno")).toBeTruthy();
    expect(sessionStorage.getItem(MFA_PENDING_KEY)).toBeNull();
  });

  it("mfa_pending ausente redireciona ao login", async () => {
    mockMfaFlow();
    sessionStorage.clear();
    renderWithRoutes();
    expect(await screen.findByText("Login interno")).toBeTruthy();
  });
});
