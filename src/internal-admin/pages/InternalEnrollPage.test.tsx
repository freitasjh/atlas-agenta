// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InternalEnrollPage } from "@/internal-admin/pages/InternalEnrollPage";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      mfa: {
        enroll: vi.fn(),
        challenge: vi.fn(),
        verify: vi.fn(),
      },
    },
  },
}));

import { supabase } from "@/lib/supabase";

const enroll = supabase.auth.mfa.enroll as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <InternalEnrollPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InternalEnrollPage", () => {
  it("passo 1 exige 1 TOTP válido antes de avançar (foco no inválido)", async () => {
    enroll.mockResolvedValue({
      data: { id: "factor-1", totp: { qr_code: "data:image/png;base64,x", secret: "ABC123" } },
      error: null,
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR de ativação" }));
    expect(await screen.findByLabelText("Chave de ativação")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("6 dígitos");
  });

  it("backup gate: concluir bloqueado sem checkbox", async () => {
    enroll.mockResolvedValue({
      data: { id: "factor-1", totp: { qr_code: "data:image/png;base64,x", secret: "ABC123" } },
      error: null,
    });
    const challenge = supabase.auth.mfa.challenge as unknown as ReturnType<typeof vi.fn>;
    const verify = supabase.auth.mfa.verify as unknown as ReturnType<typeof vi.fn>;
    challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verify.mockResolvedValue({ error: null });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR de ativação" }));
    await screen.findByLabelText("Código do autenticador");
    fireEvent.change(screen.getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar código" }));
    const finish = await screen.findByRole("button", { name: "Concluir ativação" });
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Guardei a chave/));
    expect((screen.getByRole("button", { name: "Concluir ativação" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
