// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regressão do token de webhook (ADR-20). O servidor devolve o token **uma
 * única vez** e cada "Salvar" rotaciona o segredo — se a tela não exibir o
 * valor, nenhuma cobrança passa a ser marcada como paga (webhook 401); se ela
 * rotacionar sem avisar, a configuração vigente no Asaas quebra em silêncio.
 */

const { saveMock, configState } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  configState: { current: null as Record<string, unknown> | null },
}));

vi.mock("@/hooks/useAsaasConfig", () => ({
  ASAAS_ENVIRONMENTS: ["sandbox", "production"],
  useAsaasConfig: () => ({
    data: configState.current,
    isLoading: false,
    isError: false,
  }),
  useTestAsaasConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveAsaasConfig: () => ({ mutateAsync: saveMock, isPending: false }),
}));

import { PagamentosPage } from "@/app/config/pagamentos/PagamentosPage";

const ACTIVE_CONFIG = {
  tenant_id: "t-1",
  asaas_account_id: "acc-1",
  environment: "sandbox",
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
};

const writeText = vi.fn();

beforeEach(() => {
  saveMock.mockReset();
  writeText.mockReset();
  configState.current = null;
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => cleanup());

function fillApiKey() {
  fireEvent.change(screen.getByLabelText("Chave de API"), {
    target: { value: "key" },
  });
}

describe("PagamentosPage — token de webhook", () => {
  it("exibe o token uma vez após salvar e permite copiar", async () => {
    saveMock.mockResolvedValue({ ok: true, webhook_token: "tok-123" });
    render(<PagamentosPage />);

    fillApiKey();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const tokenInput = await screen.findByLabelText("Token de webhook");
    expect((tokenInput as HTMLInputElement).value).toBe("tok-123");
    expect(screen.getAllByText(/asaas-access-token/).length).toBeGreaterThan(0);
    expect(screen.getByText(/exibido uma única vez/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Copiar token de webhook" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("tok-123"));
  });

  it("pede confirmação antes de rotacionar token de config ativa", async () => {
    configState.current = ACTIVE_CONFIG;
    saveMock.mockResolvedValue({ ok: true, webhook_token: "tok-456" });
    render(<PagamentosPage />);

    fillApiKey();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByText(
        /a configuração atual no Asaas deixará de funcionar/,
      ),
    ).toBeTruthy();
    expect(saveMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0]?.[0]).toMatchObject({
      apiKey: "key",
      environment: "sandbox",
    });
    expect(
      await screen.findByLabelText("Token de webhook"),
    ).toBeTruthy();
  });

  it("cancelar a confirmação não rotaciona o token", async () => {
    configState.current = ACTIVE_CONFIG;
    render(<PagamentosPage />);

    fillApiKey();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(saveMock).not.toHaveBeenCalled());
  });
});
