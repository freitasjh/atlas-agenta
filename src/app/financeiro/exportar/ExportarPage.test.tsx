// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportarPage } from "@/app/financeiro/exportar/ExportarPage";

const {
  entitlementsMock,
  segmentMock,
  logsMock,
  logsEnabledMock,
  mutationMock,
  mutateMock,
  toastMock,
  saveBlobMock,
} = vi.hoisted(() => ({
  entitlementsMock: vi.fn(),
  segmentMock: vi.fn(),
  logsMock: vi.fn(),
  logsEnabledMock: vi.fn(),
  mutationMock: vi.fn(),
  mutateMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  saveBlobMock: vi.fn(),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock(),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => segmentMock(),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));

vi.mock("@/hooks/useExportContabil", () => ({
  useExportLogs: (enabled: boolean) => {
    logsEnabledMock(enabled);
    return logsMock();
  },
  useExportLedger: () => mutationMock(),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/export-contabil", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export-contabil")>();
  return { ...actual, saveExportBlob: saveBlobMock };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExportarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function logsState(over: Record<string, unknown> = {}) {
  return { data: [], isPending: false, isError: false, refetch: vi.fn(), ...over };
}

beforeEach(() => {
  entitlementsMock.mockReset();
  segmentMock.mockReset();
  logsMock.mockReset();
  logsEnabledMock.mockReset();
  mutationMock.mockReset();
  mutateMock.mockReset();
  saveBlobMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();

  entitlementsMock.mockReturnValue({ exportContabil: true });
  segmentMock.mockReturnValue({ payments: true });
  logsMock.mockReturnValue(logsState());
  mutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });
});

afterEach(() => {
  cleanup();
});

describe("ExportarPage (ADR-10)", () => {
  it("gating `exportContabil` desligado: upsell e nenhuma request de trilha", () => {
    entitlementsMock.mockReturnValue({ exportContabil: false });
    renderPage();

    expect(screen.getByText(/Export contábil: recurso não incluído no plano atual/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Baixar arquivo$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Baixar arquivo \(bloqueado\)/ })).toBeTruthy();
    expect(logsEnabledMock).toHaveBeenCalledWith(false);
  });

  it("segmento sem payments: estado legível e nenhuma request", () => {
    segmentMock.mockReturnValue({ payments: false });
    renderPage();

    expect(screen.getByText(/Export disponível para salões e barbearias/)).toBeTruthy();
    expect(logsEnabledMock).toHaveBeenCalledWith(false);
  });

  it("submit chama a Edge com período/formato/escopo e baixa o arquivo", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "OFX" }));
    fireEvent.click(screen.getByRole("button", { name: "A pagar" }));
    fireEvent.click(screen.getByRole("button", { name: /Baixar arquivo/ }));

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    const [input, options] = mutateMock.mock.calls[0] as [
      Record<string, string>,
      { onSuccess: (result: { filename: string; blob: Blob }) => void },
    ];
    expect(input.formato).toBe("ofx");
    expect(input.escopo).toBe("pagar");
    expect(input.periodoIni).toBe(input.periodoIni.slice(0, 10));
    expect(input.ini.endsWith("Z")).toBe(true);

    const blob = new Blob(["OFXHEADER:100"], { type: "application/x-ofx" });
    options.onSuccess({ filename: "export-pagar-ofx.csv", blob });
    expect(saveBlobMock).toHaveBeenCalledWith("export-pagar-ofx.csv", blob);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("período vazio: mensagem legível, nenhum toast de sucesso", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Baixar arquivo/ }));
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    const [, options] = mutateMock.mock.calls[0] as [
      unknown,
      { onError: (error: Error & { code?: string | null }) => void },
    ];
    const error = Object.assign(new Error("Sem movimentos no período."), { code: "EMPTY_PERIOD" });
    options.onError(error);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Sem movimentos no período");
    });
    expect(saveBlobMock).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("trilha lista exports com autor e data", () => {
    logsMock.mockReturnValue(
      logsState({
        data: [
          {
            id: "l1",
            tipo: "ledger",
            periodo: "2026-01-01..2026-01-31",
            formato: "csv",
            arquivoPath: "export-receber-csv-2026-01-01_2026-01-31.csv",
            autorNome: "Ana Admin",
            createdAt: "2026-02-01T12:00:00.000Z",
          },
        ],
      }),
    );
    renderPage();

    expect(logsEnabledMock).toHaveBeenCalledWith(true);
    expect(screen.getByText("Recebimentos")).toBeTruthy();
    expect(screen.getByText("Ana Admin")).toBeTruthy();
    expect(screen.getByText("export-receber-csv-2026-01-01_2026-01-31.csv")).toBeTruthy();
  });

  it("trilha vazia convida a gerar o primeiro arquivo", () => {
    renderPage();
    expect(screen.getByText("Nenhum export registrado")).toBeTruthy();
  });
});
