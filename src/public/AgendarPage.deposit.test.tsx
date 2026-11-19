// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgendarPage } from "@/public/AgendarPage";

vi.mock("@/lib/env", () => ({
  env: {
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_ANON_KEY: "test-anon-key",
  },
  isSupabaseConfigured: true,
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TENANT = {
  trade_name: "Salão Teste",
  legal_name: null,
  phone: null,
};

const PROF = { id: "22222222-2222-4222-8222-222222222222", name: "Bia" };

const SLOT = {
  slot_start: "2026-11-12T12:00:00.000Z",
  slot_end: "2026-11-12T12:30:00.000Z",
};

function serviceRow(deposit: Record<string, unknown> | null) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Corte",
    duration_minutes: 30,
    price_cents: 10000,
    ...(deposit ?? {}),
  };
}

function ok(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

function installFetch(opts: {
  service: Record<string, unknown>;
  book: Record<string, unknown>;
}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("public-book")) return ok(opts.book);
    if (url.includes(`service_id=${opts.service.id}`)) {
      return ok({ slots: [SLOT] });
    }
    return ok({
      tenant: TENANT,
      services: [opts.service],
      professionals: [PROF],
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/agendar/test-token"]}>
      <Routes>
        <Route path="/agendar/:token" element={<AgendarPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Avança o wizard até a tela de confirmação (serviço → profissional → data/slot → dados). */
async function goToConfirm() {
  // Serviço.
  const serviceButton = await screen.findByRole("button", { name: /corte/i });
  fireEvent.click(serviceButton);

  // Profissional.
  const profButton = await screen.findByRole("button", { name: /bia/i });
  fireEvent.click(profButton);

  // Data (via chip "Hoje": happy-dom não confirma change em input date) + slot.
  const todayChip = await screen.findByRole("button", { name: /^hoje$/i });
  fireEvent.click(todayChip);
  const slotButton = await screen.findByRole("button", {
    name: /horário/i,
  });
  fireEvent.click(slotButton);
  fireEvent.click(screen.getByRole("button", { name: /continuar/i }));

  // Dados do cliente.
  fireEvent.change(await screen.findByLabelText(/nome completo/i), {
    target: { value: "Ana Souza" },
  });
  const phoneInput = await screen.findByLabelText(/telefone\/whatsapp/i);
  fireEvent.change(phoneInput, { target: { value: "(11) 99999-1111" } });
  fireEvent.click(screen.getByRole("button", { name: /continuar/i }));

  // Tela de confirmação.
  await screen.findByRole("button", { name: /confirmar agendamento/i });
}

describe("AgendarPage — passo depósito (ADR-12 / ADR-03)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  it("deposit_enabled=true + charge no public-book → passo PIX", async () => {
    installFetch({
      service: serviceRow({
        deposit_enabled: true,
        deposit_type: "percent",
        deposit_value: 30,
        deposit_deadline_hours: 24,
        deposit_refund_policy: "total",
      }),
      book: {
        success: true,
        appointment_id: "ap-1",
        status: "aguardando_deposito",
        charge: {
          id: "ch-1",
          status: "pendente",
          amount_cents: 3000,
          expires_at: "2026-11-13T12:00:00.000Z",
          pix_qr_code: null,
          pix_copia_e_cola: "pix-test-123",
        },
      },
    });
    renderPage();
    await goToConfirm();

    fireEvent.click(
      screen.getByRole("button", { name: /confirmar agendamento/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/depósito para confirmar/i)).toBeDefined(),
    );
    expect(screen.getByText(/pix-test-123/)).toBeDefined();
    expect(screen.getByText(/aguardando depósito/i)).toBeDefined();
  });

  it("deposit_enabled=false → fluxo legado (sem passo PIX)", async () => {
    installFetch({
      service: serviceRow({ deposit_enabled: false }),
      book: { success: true, appointment_id: "ap-1", status: "pendente" },
    });
    renderPage();
    await goToConfirm();

    fireEvent.click(
      screen.getByRole("button", { name: /confirmar agendamento/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/agendamento solicitado/i)).toBeDefined(),
    );
    expect(screen.queryByText(/depósito para confirmar/i)).toBeNull();
  });

  it("deposit_* ausente (backend legado) → fluxo legado", async () => {
    installFetch({
      service: serviceRow(null),
      book: { success: true, appointment_id: "ap-1", status: "pendente" },
    });
    renderPage();
    await goToConfirm();

    fireEvent.click(
      screen.getByRole("button", { name: /confirmar agendamento/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/agendamento solicitado/i)).toBeDefined(),
    );
    expect(screen.queryByText(/depósito para confirmar/i)).toBeNull();
  });
});
