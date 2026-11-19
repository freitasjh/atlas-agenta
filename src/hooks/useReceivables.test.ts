// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECEIVABLES_KEY,
  useCancelReceivable,
  useCancelReceivableCharge,
  useChargeReceivable,
  useCreateReceivable,
  useReceivables,
  useSettleReceivable,
} from "@/hooks/useReceivables";

const { fromMock, rpcMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    functions: { invoke: invokeMock },
  },
}));

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return { result, queryClient };
}

const AVULSA = {
  id: "r-1",
  tenant_id: "t-1",
  customer_id: "c-1",
  descricao: "Produto fora do caixa",
  categoria: "avulsa",
  vencimento_at: "2026-12-10T12:00:00.000Z",
  valor_cents: 10_000,
  status: "pendente",
  asaas_payment_id: null,
  pix_qr_code: null,
  pix_copy_paste: null,
  charge_expires_at: null,
  created_at: "2026-11-01T12:00:00.000Z",
  recebido_cents: 4_000,
};

describe("useReceivables — contrato ADR-07", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lê a lista agregada pela RPC e descarta status fora do domínio", async () => {
    rpcMock.mockResolvedValue({
      data: [AVULSA, { ...AVULSA, id: "r-2", status: "estranho" }],
      error: null,
    });
    const { result } = renderWithClient(() => useReceivables(true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("receivable_list");
    expect(result.current.data?.map((r) => r.id)).toEqual(["r-1"]);
    // Agregação vem do banco: nada de somar settlements em memória.
    expect(result.current.data?.[0]?.recebido_cents).toBe(4_000);
  });

  it("linha sem recebido_cents assume zero (contrato tolerante)", async () => {
    const { recebido_cents: _omitido, ...semSoma } = AVULSA;
    rpcMock.mockResolvedValue({ data: [semSoma], error: null });
    const { result } = renderWithClient(() => useReceivables(true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.recebido_cents).toBe(0);
  });

  it("enabled=false não dispara request", async () => {
    const { result } = renderWithClient(() => useReceivables(false));
    await act(async () => {});
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("cria avulsa pela RPC com centavos e invalida a lista", async () => {
    rpcMock.mockResolvedValue({ data: { receivable_id: "r-9", status: "pendente" }, error: null });
    const { result, queryClient } = renderWithClient(() => useCreateReceivable());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        customer_id: "11111111-1111-4111-8111-111111111111",
        descricao: "Corte extra",
        categoria: "avulsa",
        vencimento_at: "2026-12-10T12:00:00.000Z",
        valor_cents: 5_000,
      });
    });

    expect(rpcMock).toHaveBeenCalledWith("receivable_create", {
      p_customer_id: "11111111-1111-4111-8111-111111111111",
      p_descricao: "Corte extra",
      p_valor_cents: 5_000,
      p_vencimento_at: "2026-12-10T12:00:00.000Z",
      p_categoria: "avulsa",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: RECEIVABLES_KEY });
  });

  it("recebimento parcial devolve status e saldo da RPC", async () => {
    rpcMock.mockResolvedValue({ data: { status: "parcial", resto_cents: 6_000 }, error: null });
    const { result } = renderWithClient(() => useSettleReceivable());

    let saida: { status: string; resto_cents: number } | undefined;
    await act(async () => {
      saida = await result.current.mutateAsync({
        receivable_id: "r-1",
        valor_cents: 4_000,
        recebido_at: "2026-11-13T12:00:00.000Z",
        metodo: "pix",
      });
    });

    expect(saida).toEqual({ status: "parcial", resto_cents: 6_000 });
    expect(rpcMock).toHaveBeenCalledWith("receivable_settle", {
      p_receivable_id: "r-1",
      p_valor_cents: 4_000,
      p_recebido_at: "2026-11-13T12:00:00.000Z",
      p_metodo: "pix",
    });
  });

  it("PT409 da RPC vira mensagem pt-BR (nunca o código cru)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "RECEIVABLE_HAS_ACTIVE_CHARGE", code: "PT409" },
    });
    const { result } = renderWithClient(() => useSettleReceivable());

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          receivable_id: "r-1",
          valor_cents: 1_000,
          recebido_at: "2026-11-13T12:00:00.000Z",
          metodo: "pix",
        });
      }),
    ).rejects.toThrow(/PIX em aberto/i);
  });

  it("cancelar conta mapeia RECEIVABLE_HAS_ACTIVE_CHARGE", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "RECEIVABLE_HAS_ACTIVE_CHARGE", code: "PT409" },
    });
    const { result } = renderWithClient(() => useCancelReceivable());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ receivable_id: "r-1", motivo: null });
      }),
    ).rejects.toThrow(/Cancele o PIX/i);
  });

  it("cobrança reusa o PIX devolvido pela Edge", async () => {
    invokeMock.mockResolvedValue({
      data: {
        receivable_id: "r-1",
        status: "pendente",
        amount_cents: 10_000,
        pix_qr_code: "qr",
        pix_copy_paste: "copia-cola",
        expires_at: null,
        reused: true,
        whatsapp: { requested: true, queued: false, message_id: "m-1" },
      },
      error: null,
    });
    const { result } = renderWithClient(() => useChargeReceivable());

    let saida: unknown;
    await act(async () => {
      saida = await result.current.mutateAsync({ receivable_id: "r-1", notify_whatsapp: true });
    });

    expect(invokeMock).toHaveBeenCalledWith("create-receivable-charge", {
      body: { receivable_id: "r-1", notify_whatsapp: true },
    });
    expect(saida).toMatchObject({ reused: true, pix_copy_paste: "copia-cola" });
  });

  it("erro de opt-in da Edge vira mensagem pt-BR legível", async () => {
    const context = new Response(
      JSON.stringify({ code: "WHATSAPP_OPT_IN_REQUIRED", message: "WHATSAPP_OPT_IN_REQUIRED" }),
      { status: 422 },
    );
    invokeMock.mockResolvedValue({ data: null, error: { context } });
    const { result } = renderWithClient(() => useChargeReceivable());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ receivable_id: "r-1", notify_whatsapp: true });
      }),
    ).rejects.toThrow(/consentimento de WhatsApp/i);
  });

  it("cancelar PIX chama a Edge e invalida a lista", async () => {
    invokeMock.mockResolvedValue({
      data: { receivable_id: "r-1", status: "pendente", cancelled: true },
      error: null,
    });
    const { result, queryClient } = renderWithClient(() => useCancelReceivableCharge());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ receivable_id: "r-1" });
    });

    expect(invokeMock).toHaveBeenCalledWith("cancel-receivable-charge", {
      body: { receivable_id: "r-1" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: RECEIVABLES_KEY });
  });

  it("falha do gateway ao cancelar PIX vira pt-BR", async () => {
    const context = new Response(
      JSON.stringify({ code: "GATEWAY_CANCEL_FAILED", message: "GATEWAY_CANCEL_FAILED" }),
      { status: 422 },
    );
    invokeMock.mockResolvedValue({ data: null, error: { context } });
    const { result } = renderWithClient(() => useCancelReceivableCharge());

    await expect(
      act(async () => {
        await result.current.mutateAsync({ receivable_id: "r-1" });
      }),
    ).rejects.toThrow(/Falha ao cancelar o PIX/i);
  });
});
