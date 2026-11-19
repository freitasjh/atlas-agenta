// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FotosAntesDepois } from "@/app/agenda/prontuario/FotosAntesDepois";

const { storageFromMock } = vi.hoisted(() => ({ storageFromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: storageFromMock } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const C_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fileObjects() {
  return [
    { name: "antes-20261110-120000-a1b2c3.jpg" },
    { name: "depois-20261111-120000-d4e5f6.jpg" },
  ];
}

function mockStorageEmpty() {
  const bucket = {
    list: vi.fn(() => Promise.resolve({ data: [], error: null })),
    createSignedUrl: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
  };
  storageFromMock.mockReturnValue(bucket);
  return bucket;
}

function mockStorageWithPhotos() {
  const bucket = {
    list: vi.fn(() =>
      Promise.resolve({ data: fileObjects(), error: null }),
    ),
    createSignedUrl: vi.fn((path: string) =>
      Promise.resolve({ data: { signedUrl: `https://cdn.test/${path}` }, error: null }),
    ),
    upload: vi.fn(() => Promise.resolve({ data: { path: "x" }, error: null })),
    download: vi.fn(),
    remove: vi.fn(),
  };
  storageFromMock.mockReturnValue(bucket);
  return bucket;
}

function renderFotos(props?: { consented?: boolean; canWrite?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return render(
    createElement(FotosAntesDepois, {
      customerId: C_ID,
      appointmentId: AP_ID,
      timeZone: "America/Sao_Paulo",
      consented: props?.consented ?? true,
      canWrite: props?.canWrite ?? true,
      enabled: true,
    }),
    { wrapper: Wrapper },
  );
}

afterEach(cleanup);

beforeEach(() => {
  storageFromMock.mockReset();
});

describe("FotosAntesDepois — gate de consentimento", () => {
  it("sem consentimento: upload recusado com mensagem, sem input de arquivo", async () => {
    const bucket = mockStorageEmpty();
    renderFotos({ consented: false });
    expect(
      await screen.findByText(/termo de consentimento/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/escolher foto/i)).toBeNull();
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it("com consentimento: mostra input de envio", async () => {
    mockStorageEmpty();
    renderFotos({ consented: true });
    expect(await screen.findByLabelText(/escolher foto/i)).toBeTruthy();
  });
});

describe("FotosAntesDepois — grid e alt", () => {
  it("renderiza miniaturas com alt Antes/Depois + data e lazy", async () => {
    mockStorageWithPhotos();
    renderFotos();
    const antes = await screen.findByAltText("Antes — 10/11/2026");
    const depois = await screen.findByAltText("Depois — 11/11/2026");
    expect(antes.getAttribute("loading")).toBe("lazy");
    expect(depois.getAttribute("loading")).toBe("lazy");
  });

  it("não expõe nenhuma ação de excluir e nunca chama remove", async () => {
    const bucket = mockStorageWithPhotos();
    renderFotos();
    await screen.findByAltText("Antes — 10/11/2026");
    expect(screen.queryByRole("button", { name: /excluir|remover|apagar/i })).toBeNull();
    expect(bucket.remove).not.toHaveBeenCalled();
  });
});

describe("FotosAntesDepois — lightbox lado a lado", () => {
  it("abre focado, fecha com Esc e devolve o foco ao gatilho", async () => {
    mockStorageWithPhotos();
    renderFotos();
    const thumb = await screen.findByRole("button", { name: /antes — 10\/11\/2026/i });
    fireEvent.click(thumb);
    const dialog = await screen.findByRole("dialog", { name: /comparar antes e depois/i });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toMatch(/antes/i);
    expect(dialog.textContent).toMatch(/depois/i);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /comparar antes e depois/i })).toBeNull();
    });
    expect(document.activeElement).toBe(thumb);
  });

  it("setas ArrowRight/ArrowLeft navegam entre fotos sem fechar", async () => {
    mockStorageWithPhotos();
    renderFotos();
    const thumb = await screen.findByRole("button", { name: /antes — 10\/11\/2026/i });
    fireEvent.click(thumb);
    const dialog = await screen.findByRole("dialog", { name: /comparar antes e depois/i });
    const mainAlt = () =>
      dialog.querySelectorAll("figure img")[0]?.getAttribute("alt") ?? "";
    expect(mainAlt()).toMatch(/Antes/);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    await waitFor(() => {
      expect(mainAlt()).toMatch(/Depois/);
    });
    expect(screen.queryByRole("dialog", { name: /comparar antes e depois/i })).not.toBeNull();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(mainAlt()).toMatch(/Antes/);
    });
  });
});
