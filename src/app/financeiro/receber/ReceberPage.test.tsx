// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReceberPage } from "@/app/financeiro/receber/ReceberPage";

const {
  segmentMock,
  receivablesMock,
  createMock,
  settleMock,
  chargeMock,
  cancelChargeMock,
  customersMock,
} = vi.hoisted(() => ({
  segmentMock: vi.fn(),
  receivablesMock: vi.fn(),
  createMock: vi.fn(),
  settleMock: vi.fn(),
  chargeMock: vi.fn(),
  cancelChargeMock: vi.fn(),
  customersMock: vi.fn(),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => segmentMock(),
}));

vi.mock("@/hooks/useFinancialSummary", () => ({
  useFinancialSummary: () => ({
    data: {
      received_service_cents: 12_000,
      received_tips_cents: 1_000,
      received_total_cents: 13_000,
      receivable_cents: 2_000,
      open_cents: 5_000,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useReceivables", () => ({
  useReceivables: () => receivablesMock(),
  useReceivableLedger: () => ({
    data: [
      {
        id: "led-1",
        appointment_id: "ap-1",
        method: "pix_sistema",
        amount_cents: 7_000,
        tip_cents: 1_000,
        source: "asaas",
        received_at: "2026-11-10T12:00:00.000Z",
        customer_name: "Maria Souza",
        service_name: "Corte",
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateReceivable: () => createMock(),
  useSettleReceivable: () => settleMock(),
  useChargeReceivable: () => chargeMock(),
  useCancelReceivableCharge: () => cancelChargeMock(),
  useCancelReceivable: () => ({ mutateAsync: vi.fn(), isPending: false, reset: vi.fn() }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => customersMock(),
}));

const CLIENTE = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "t1",
  name: "Maria Souza",
  phone: "11999999999",
  email: null,
  whatsapp_opt_in: true,
  active: true,
  created_at: "2026-10-01T12:00:00.000Z",
};

const PARCIAL = {
  id: "22222222-2222-4222-8222-222222222222",
  tenant_id: "t1",
  customer_id: CLIENTE.id,
  descricao: "Produto fora do caixa",
  categoria: "avulsa",
  vencimento_at: "2026-12-10T12:00:00.000Z",
  valor_cents: 10_000,
  status: "parcial",
  asaas_payment_id: null,
  pix_qr_code: null,
  pix_copy_paste: null,
  charge_expires_at: null,
  created_at: "2026-11-01T12:00:00.000Z",
  recebido_cents: 4_000,
};

const PENDENTE = {
  ...PARCIAL,
  id: "33333333-3333-4333-8333-333333333333",
  descricao: "Cobrança pendente",
  status: "pendente",
  recebido_cents: 0,
};

const PIX_ABERTO = {
  ...PARCIAL,
  id: "44444444-4444-4444-8444-444444444444",
  descricao: "Conta com PIX aberto",
  status: "pendente",
  asaas_payment_id: "pay-live",
  pix_copy_paste: "copia-e-cola",
  charge_expires_at: "2026-12-20T12:00:00.000Z",
  recebido_cents: 0,
};

function mutation(over: Record<string, unknown> = {}) {
  return { mutateAsync: vi.fn(), isPending: false, reset: vi.fn(), ...over };
}

function setup() {
  segmentMock.mockReturnValue({ payments: true });
  receivablesMock.mockReturnValue({
    data: [PENDENTE, PARCIAL, PIX_ABERTO],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  customersMock.mockReturnValue({
    data: [CLIENTE],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  createMock.mockReturnValue(mutation());
  settleMock.mockReturnValue(mutation());
  chargeMock.mockReturnValue(mutation());
  cancelChargeMock.mockReturnValue(mutation());
}

function abrirAvulsas() {
  const tab = screen.getByRole("tab", { name: "Avulsas" });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReceberPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReceberPage — ADR-07 (2 abas, barra, cobrar/receber, gating)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("segmento payments=null → estado de carregamento, sem escrita", () => {
    setup();
    segmentMock.mockReturnValue({ payments: null });
    renderPage();
    expect(screen.getByText("Carregando contas a receber")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /nova cobrança/i })).toBeNull();
  });

  it("segmento payments=false → estado legível de ramo, sem abas", () => {
    setup();
    segmentMock.mockReturnValue({ payments: false });
    renderPage();
    expect(
      screen.getByText("Contas a receber disponíveis para salões e barbearias"),
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Avulsas" })).toBeNull();
  });

  it("aba Atendimentos é readonly, soma gorjeta no valor e bate com o resumo", () => {
    setup();
    renderPage();
    expect(screen.getByRole("tab", { name: "Atendimentos" })).toBeTruthy();
    expect(screen.getByText("Recebido no mês")).toBeTruthy();
    expect(screen.getByText("Maria Souza")).toBeTruthy();
    // Valor da linha = serviço (70,00) + gorjeta (10,00) = 80,00, coerente com o card.
    expect(screen.getByText("R$ 80,00")).toBeTruthy();
    expect(screen.getByText(/Serviço R\$ 70,00 · Gorjeta R\$ 10,00/)).toBeTruthy();
    expect(
      screen.getByText(/Fonte única de receita de atendimento\. Esta aba é somente leitura/i),
    ).toBeTruthy();
    // Nenhuma ação de escrita na aba do ledger.
    expect(screen.queryByRole("button", { name: /nova cobrança/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /receber/i })).toBeNull();
  });

  it("aba Avulsas mostra barra pago vs total e ações por estado", async () => {
    setup();
    renderPage();
    abrirAvulsas();

    await waitFor(() => expect(screen.getByText("Produto fora do caixa")).toBeTruthy());
    expect(screen.getByText("Cobrança pendente")).toBeTruthy();
    // Barra acessível: 4.000 de 10.000 = 40%.
    const barra = screen
      .getAllByRole("progressbar")
      .find((el) => el.getAttribute("aria-valuenow") === "40");
    expect(barra).toBeTruthy();
    expect(barra?.getAttribute("aria-label")).toMatch(/Recebido.*40,00.*100,00.*40%/);
    // Conta parcial SEM PIX: baixa manual disponível.
    expect(
      screen.getByRole("button", { name: /registrar recebimento de produto fora do caixa/i }),
    ).toBeTruthy();
    // Parcial não gera novo PIX.
    expect(
      screen.queryByRole("button", { name: /cobrar produto fora do caixa/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /cobrar cobrança pendente/i }),
    ).toBeTruthy();
  });

  it("conta com PIX vivo: esconde Receber/Cancelar e oferece Cancelar PIX", async () => {
    setup();
    const cancelarPix = mutation();
    cancelChargeMock.mockReturnValue(cancelarPix);
    renderPage();
    abrirAvulsas();

    await waitFor(() => expect(screen.getByText("Conta com PIX aberto")).toBeTruthy());
    expect(screen.getByText("PIX em aberto")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /registrar recebimento de conta com pix aberto/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^cancelar conta com pix aberto$/i }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /cancelar pix de conta com pix aberto/i }),
    );
    await waitFor(() => expect(cancelarPix.mutateAsync).toHaveBeenCalledTimes(1));
    expect(cancelarPix.mutateAsync).toHaveBeenCalledWith({ receivable_id: PIX_ABERTO.id });
  });

  it("erro ao cancelar o PIX na lista aparece em pt-BR", async () => {
    setup();
    cancelChargeMock.mockReturnValue(
      mutation({
        mutateAsync: vi
          .fn()
          .mockRejectedValue(new Error("Falha ao cancelar o PIX no gateway. A cobrança continua ativa.")),
      }),
    );
    renderPage();
    abrirAvulsas();
    await waitFor(() => expect(screen.getByText("Conta com PIX aberto")).toBeTruthy());
    fireEvent.click(
      screen.getByRole("button", { name: /cancelar pix de conta com pix aberto/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Falha ao cancelar o PIX/i),
    );
  });

  it("criar avulsa envia centavos para a RPC", async () => {
    setup();
    const criar = mutation();
    createMock.mockReturnValue(criar);
    renderPage();
    abrirAvulsas();
    fireEvent.click(screen.getByRole("button", { name: /nova cobrança/i }));

    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: CLIENTE.id } });
    fireEvent.change(screen.getByLabelText("Descrição"), {
      target: { value: "Venda de produto" },
    });
    fireEvent.change(screen.getByLabelText("Vencimento"), {
      target: { value: "2026-12-10T12:00" },
    });
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "50,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cobrança" }));

    await waitFor(() => expect(criar.mutateAsync).toHaveBeenCalledTimes(1));
    expect(criar.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: CLIENTE.id,
        descricao: "Venda de produto",
        categoria: "avulsa",
        valor_cents: 5_000,
      }),
    );
  });

  it("registrar recebimento usa o saldo como default e envia a RPC", async () => {
    setup();
    const receber = mutation();
    settleMock.mockReturnValue(receber);
    renderPage();
    abrirAvulsas();
    fireEvent.click(
      screen.getByRole("button", { name: /registrar recebimento de produto fora do caixa/i }),
    );

    await waitFor(() => expect(screen.getByLabelText("Valor recebido (R$)")).toBeTruthy());
    expect((screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement).value).toBe("60,00");

    fireEvent.click(screen.getByRole("button", { name: "Registrar recebimento" }));
    await waitFor(() => expect(receber.mutateAsync).toHaveBeenCalledTimes(1));
    expect(receber.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        receivable_id: PARCIAL.id,
        valor_cents: 6_000,
        metodo: "pix",
      }),
    );
  });

  it("recebimento acima do saldo é barrado antes da RPC (pt-BR)", async () => {
    setup();
    const receber = mutation();
    settleMock.mockReturnValue(receber);
    renderPage();
    abrirAvulsas();
    fireEvent.click(
      screen.getByRole("button", { name: /registrar recebimento de produto fora do caixa/i }),
    );

    await waitFor(() => expect(screen.getByLabelText("Valor recebido (R$)")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Valor recebido (R$)"), {
      target: { value: "90,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar recebimento" }));

    await waitFor(() =>
      expect(screen.getByText(/O valor excede o saldo de R\$ 60,00/i)).toBeTruthy(),
    );
    expect(receber.mutateAsync).not.toHaveBeenCalled();
  });

  it("cobrar no WhatsApp pede opt-in e exibe o bloqueio da Edge", async () => {
    setup();
    const cobrar = mutation({
      mutateAsync: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Cliente sem consentimento de WhatsApp (opt-in). Registre o consentimento antes de cobrar.",
          ),
        ),
    });
    chargeMock.mockReturnValue(cobrar);
    renderPage();
    abrirAvulsas();
    fireEvent.click(screen.getByRole("button", { name: /cobrar cobrança pendente/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar no WhatsApp" }));

    await waitFor(() => expect(cobrar.mutateAsync).toHaveBeenCalledTimes(1));
    expect(cobrar.mutateAsync).toHaveBeenCalledWith({
      receivable_id: PENDENTE.id,
      notify_whatsapp: true,
    });
    expect(screen.getByRole("alert").textContent).toMatch(/consentimento de WhatsApp/i);
  });

  it("cobrança gera PIX e mostra copia e cola reaproveitado", async () => {
    setup();
    const cobrar = mutation({
      mutateAsync: vi.fn().mockResolvedValue({
        receivable_id: PENDENTE.id,
        status: "pendente",
        amount_cents: 10_000,
        pix_qr_code: null,
        pix_copy_paste: "00020126copia-cola",
        expires_at: null,
        reused: true,
        whatsapp: { requested: false, queued: false, message_id: null },
      }),
    });
    chargeMock.mockReturnValue(cobrar);
    renderPage();
    abrirAvulsas();
    fireEvent.click(screen.getByRole("button", { name: /cobrar cobrança pendente/i }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar PIX" }));

    await waitFor(() =>
      expect((screen.getByLabelText("PIX copia e cola") as HTMLInputElement).value).toBe(
        "00020126copia-cola",
      ),
    );
    expect(cobrar.mutateAsync).toHaveBeenCalledWith({
      receivable_id: PENDENTE.id,
      notify_whatsapp: false,
    });
    expect(screen.getByText(/Cobrança existente reaproveitada/i)).toBeTruthy();
  });
});
