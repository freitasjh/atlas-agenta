// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapaFacial, ZONAS_FACIAIS } from "@/app/agenda/prontuario/MapaFacial";

const { storageFromMock } = vi.hoisted(() => ({ storageFromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: storageFromMock } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const C_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function mockStorage() {
  const bucket = {
    list: vi.fn(),
    createSignedUrl: vi.fn(),
    upload: vi.fn(
      (
        _p: string,
        _b?: unknown,
        _o?: unknown,
      ): Promise<{
        data: { path: string } | null;
        error: { message: string } | null;
      }> => Promise.resolve({ data: { path: "x" }, error: null }),
    ),
    download: vi.fn(
      (): Promise<{ data: Blob | null; error: { message: string } | null }> =>
        Promise.resolve({ data: null, error: { message: "not found" } }),
    ),
    remove: vi.fn(),
  };
  storageFromMock.mockReturnValue(bucket);
  return bucket;
}

function renderMapa(canWrite = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return render(
    createElement(MapaFacial, {
      customerId: C_ID,
      appointmentId: AP_ID,
      canWrite,
      enabled: true,
    }),
    { wrapper: Wrapper },
  );
}

afterEach(cleanup);

beforeEach(() => {
  storageFromMock.mockReset();
});

describe("MapaFacial — zonas como botões nativos", () => {
  it("cada zona é um <button> nativo com nome acessível", async () => {
    mockStorage();
    renderMapa();
    for (const zona of ZONAS_FACIAIS) {
      const btn = await screen.findByRole("button", { name: zona.nome });
      expect(btn.tagName).toBe("BUTTON");
    }
  });

  it("alternar zona atualiza aria-pressed e a lista textual espelhada", async () => {
    mockStorage();
    renderMapa();
    const btn = await screen.findByRole("button", { name: "Nariz" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    const item = await screen.findByTestId("zona-lista-nariz");
    expect(item.textContent).toMatch(/marcada/i);
  });

  it("lista textual espelha todas as zonas com estado", async () => {
    mockStorage();
    renderMapa();
    const lista = await screen.findByRole("list", { name: /zonas registradas/i });
    expect(lista).toBeTruthy();
    for (const zona of ZONAS_FACIAIS) {
      expect(
        await screen.findByTestId(`zona-lista-${zona.id}`),
      ).toBeTruthy();
    }
  });

  it("somente leitura sem escrita: zonas desabilitadas", async () => {
    mockStorage();
    renderMapa(false);
    const btn = await screen.findByRole("button", { name: "Testa" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("2º salvamento após reload usa upsert e persiste (sem 42501)", async () => {
    const firstZones = { zones: ["testa"] };
    const bucket = mockStorage();
    bucket.download.mockImplementationOnce(() =>
      Promise.resolve({
        data: new Blob([JSON.stringify(firstZones)], { type: "application/json" }),
        error: null,
      }),
    );
    // reload: segundo fetch devolve o que o 1º save persistiu
    bucket.download.mockImplementation(() =>
      Promise.resolve({
        data: new Blob([JSON.stringify({ zones: ["testa", "nariz"] })], {
          type: "application/json",
        }),
        error: null,
      }),
    );
    const { unmount } = renderMapa();
    const nariz = await screen.findByRole("button", { name: "Nariz" });
    fireEvent.click(nariz);
    await screen.findByTestId("zona-lista-nariz");
    expect(bucket.upload).toHaveBeenCalledTimes(1);
    expect(bucket.upload.mock.calls[0]?.[2]).toMatchObject({ upsert: true });
    unmount();
    cleanup();
    renderMapa();
    const queixo = await screen.findByRole("button", { name: "Queixo" });
    fireEvent.click(queixo);
    await screen.findByTestId("zona-lista-queixo");
    expect(bucket.upload).toHaveBeenCalledTimes(2);
    expect(bucket.upload.mock.calls[1]?.[2]).toMatchObject({ upsert: true });
    const body = bucket.upload.mock.calls[1]?.[1] as unknown as Blob;
    expect(await body.text()).toContain("queixo");
  });
});
