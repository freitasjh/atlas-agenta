// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NfcePage } from "@/app/financeiro/nfce/NfcePage";

const { entitlementsMock, fromMock, invokeMock } = vi.hoisted(() => ({
  entitlementsMock: vi.fn(),
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args), functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

const CHAVE = "1".repeat(44);

const DOC_AUTORIZADA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  origem_tipo: "appointment",
  origem_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  numero: "123456",
  serie: "1",
  chave_acesso: CHAVE,
  status: "autorizada",
  valor_cents: 4500,
  xml: "<nfe/>",
  danfe_url: null,
  created_at: "2026-11-01T12:00:00.000Z",
  authorized_at: "2026-11-01T12:01:00.000Z",
};

const DOC_CONTINGENCIA = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  origem_tipo: "sale",
  origem_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  numero: null,
  serie: "1",
  chave_acesso: null,
  status: "contingencia",
  valor_cents: 8990,
  xml: null,
  danfe_url: null,
  created_at: "2026-11-02T12:00:00.000Z",
  authorized_at: null,
};

/** Builder thenable do PostgREST (select/order/limit/eq encadeáveis). */
function chain(data: unknown) {
  const builder = {} as Record<string, (...a: never[]) => unknown>;
  for (const metodo of ["select", "order", "limit", "eq", "maybeSingle", "single"] as const) {
    builder[metodo] = () => builder;
  }
  builder["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NfcePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NfcePage — ADR-03 (emissão, contingência, cancelamento, DANFE, gating)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gating nfce=false → upsell legível e zero request a fiscal_*", async () => {
    entitlementsMock.mockReturnValue({ nfce: false });
    fromMock.mockImplementation(() => chain([]));
    renderPage();
    expect(screen.getByText("Notas fiscais disponíveis no plano")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver planos" })).toBeTruthy();
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("gating nfce=null → upsell sem travar e zero request", async () => {
    entitlementsMock.mockReturnValue(null);
    fromMock.mockImplementation(() => chain([]));
    renderPage();
    expect(screen.getByText("Notas fiscais disponíveis no plano")).toBeTruthy();
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
  });

  it("liberado → lista com badges, contingência sem valor fiscal e sem invoke", async () => {
    entitlementsMock.mockReturnValue({ nfce: true });
    fromMock.mockImplementation((tabela: string) =>
      chain(tabela === "fiscal_documents" ? [DOC_AUTORIZADA, DOC_CONTINGENCIA] : []),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("nº 123456")).toBeTruthy());
    expect(screen.getAllByText("Autorizada").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Contingência").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("sem valor fiscal")).toBeTruthy();
    expect(screen.getByText("R$ 45,00")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("DANFE abre modal com QR e chave; contingência mostra marca sem valor fiscal", async () => {
    entitlementsMock.mockReturnValue({ nfce: true });
    fromMock.mockImplementation((tabela: string) =>
      chain(tabela === "fiscal_documents" ? [DOC_AUTORIZADA, DOC_CONTINGENCIA] : []),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("nº 123456")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "DANFE" })[0]);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /QR Code da DANFE/ })).toBeTruthy(),
    );
    expect(screen.getByText(/chNFe=/)).toBeTruthy();
  });

  it("contingência tem Reemitir e autorizada tem Cancelar", async () => {
    entitlementsMock.mockReturnValue({ nfce: true });
    fromMock.mockImplementation((tabela: string) =>
      chain(tabela === "fiscal_documents" ? [DOC_AUTORIZADA, DOC_CONTINGENCIA] : []),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("nº 123456")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Reemitir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reemitir" }));
    await waitFor(() => expect(screen.getByText(/Reemissão da mesma origem/)).toBeTruthy());
  });

  it("cancelamento exige motivo de 15+ caracteres e chama a Edge", async () => {
    entitlementsMock.mockReturnValue({ nfce: true });
    fromMock.mockImplementation((tabela: string) =>
      chain(tabela === "fiscal_documents" ? [DOC_AUTORIZADA] : []),
    );
    invokeMock.mockResolvedValue({ data: { document_id: DOC_AUTORIZADA.id, replayed: false }, error: null });
    renderPage();
    await waitFor(() => expect(screen.getByText("nº 123456")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.getByLabelText("Motivo")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(screen.getByText(/ao menos 15 caracteres/)).toBeTruthy(),
    );
    expect(invokeMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Erro de digitação no valor do item fiscal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "cancel-nfce",
        expect.objectContaining({
          body: expect.objectContaining({
            fiscal_document_id: DOC_AUTORIZADA.id,
            acao: "cancelamento",
          }),
        }),
      ),
    );
  });

  it("emissão chama issue-nfce com snapshot em centavos", async () => {
    entitlementsMock.mockReturnValue({ nfce: true });
    fromMock.mockImplementation(() => chain([]));
    invokeMock.mockResolvedValue({
      data: { document: { ...DOC_AUTORIZADA, origem_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, replayed: true },
      error: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Nenhuma nota fiscal ainda")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "Emitir nota" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Identificador da origem")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Identificador da origem"), {
      target: { value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    });
    fireEvent.change(screen.getByLabelText(/Valor/), {
      target: { value: "45,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Emitir nota$/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "issue-nfce",
        expect.objectContaining({
          body: expect.objectContaining({ valor_cents: 4500 }),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/nenhuma linha duplicada/)).toBeTruthy());
  });
});
