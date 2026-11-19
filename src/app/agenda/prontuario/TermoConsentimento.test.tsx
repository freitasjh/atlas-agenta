// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TermoConsentimento } from "@/app/agenda/prontuario/TermoConsentimento";
import { mapConsentimentoError } from "@/app/agenda/prontuario/consentimento";

const { storageFromMock } = vi.hoisted(() => ({ storageFromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: storageFromMock } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const C_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function mockStorageUnsigned() {
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
        Promise.resolve({ data: null, error: { message: "Object not found" } }),
    ),
    remove: vi.fn(),
  };
  storageFromMock.mockReturnValue(bucket);
  return bucket;
}

function renderTermo(onStatusChange?: (consented: boolean) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return render(
    createElement(TermoConsentimento, {
      customerId: C_ID,
      timeZone: "America/Sao_Paulo",
      canWrite: true,
      enabled: true,
      onStatusChange: onStatusChange ?? (() => {}),
    }),
    { wrapper: Wrapper },
  );
}

afterEach(cleanup);

beforeEach(() => {
  storageFromMock.mockReset();
});

describe("TermoConsentimento — estado pendente", () => {
  it("exibe status pendente e botão de assinatura", async () => {
    mockStorageUnsigned();
    renderTermo();
    expect(await screen.findByText(/termo pendente/i)).toBeTruthy();
    expect(await screen.findByRole("button", { name: /assinar termo/i })).toBeTruthy();
  });

  it("checkbox LGPD inicia desmarcado sempre", async () => {
    mockStorageUnsigned();
    renderTermo();
    fireEvent.click(await screen.findByRole("button", { name: /assinar termo/i }));
    const checkbox = await screen.findByRole("checkbox", { name: /de acordo/i });
    expect((checkbox as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
  });

  it("recusa concluir sem checkbox + (traço ou nome)", async () => {
    mockStorageUnsigned();
    const bucket = storageFromMock.mock.results.length
      ? (storageFromMock.mock.results[0]?.value as { upload: ReturnType<typeof vi.fn> })
      : null;
    void bucket;
    renderTermo();
    fireEvent.click(await screen.findByRole("button", { name: /assinar termo/i }));
    fireEvent.click(await screen.findByRole("button", { name: /confirmar assinatura/i }));
    expect(
      await screen.findByText(/marque o aceite.*assine no quadro ou informe o nome/i),
    ).toBeTruthy();
  });

  it("conclui com nome digitado + checkbox (sem traço)", async () => {
    const bucket = mockStorageUnsigned();
    renderTermo();
    fireEvent.click(await screen.findByRole("button", { name: /assinar termo/i }));
    fireEvent.change(await screen.findByLabelText(/nome completo/i), {
      target: { value: "Maria Silva" },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /de acordo/i }));
    fireEvent.click(await screen.findByRole("button", { name: /confirmar assinatura/i }));
    await waitFor(() => {
      expect(bucket.upload).toHaveBeenCalledTimes(1);
    });
    const [path, body] = bucket.upload.mock.calls[0] as unknown as [string, Blob];
    expect(path).toMatch(/termo-consentimento\.json$/);
    expect(body).toBeInstanceOf(Blob);
  });

  it("conclui com traço no quadro + checkbox (sem nome)", async () => {
    const bucket = mockStorageUnsigned();
    renderTermo();
    fireEvent.click(await screen.findByRole("button", { name: /assinar termo/i }));
    const quadro = await screen.findByTestId("quadro-assinatura");
    fireEvent.pointerDown(quadro, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(quadro, { clientX: 40, clientY: 30 });
    fireEvent.pointerUp(quadro);
    fireEvent.click(await screen.findByRole("checkbox", { name: /de acordo/i }));
    fireEvent.click(await screen.findByRole("button", { name: /confirmar assinatura/i }));
    await waitFor(() => {
      expect(bucket.upload).toHaveBeenCalledTimes(1);
    });
  });
});

describe("TermoConsentimento — assinado é imutável", () => {
  function mockStorageSigned() {
    const payload = {
      customerId: C_ID,
      signerName: "Maria Silva",
      signedAt: "2026-11-10T12:00:00.000Z",
      method: "nome",
      hash: "abc123",
    };
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
          Promise.resolve({
            data: new Blob([JSON.stringify(payload)], { type: "application/json" }),
            error: null,
          }),
      ),
      remove: vi.fn(),
    };
    storageFromMock.mockReturnValue(bucket);
    return bucket;
  }

  it("exibe nome, data e hash; sem ação de editar ou excluir", async () => {
    mockStorageSigned();
    renderTermo();
    expect(await screen.findByText(/maria silva/i)).toBeTruthy();
    expect(await screen.findByText(/abc123/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /assinar termo/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /editar|excluir|remover|apagar/i })).toBeNull();
  });

  it("notifica consentimento ativo ao hospedeiro", async () => {
    mockStorageSigned();
    const onStatusChange = vi.fn();
    renderTermo(onStatusChange);
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(true);
    });
  });
});

describe("TermoConsentimento — a11y dos campos do dialog (QA P2/P3)", () => {
  it("todo input/select/textarea do dialog tem id + name; canvas e checkbox têm nome acessível", async () => {
    mockStorageUnsigned();
    renderTermo();
    fireEvent.click(await screen.findByRole("button", { name: /assinar termo/i }));
    const dialog = await screen.findByRole("dialog");
    const fields = Array.from(dialog.querySelectorAll("input, select, textarea"));
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.getAttribute("id")).toBeTruthy();
      expect(field.getAttribute("name")).toBeTruthy();
    }
    const quadro = await screen.findByTestId("quadro-assinatura");
    expect(quadro.getAttribute("id")).toBe("quadro-assinatura");
    expect(
      quadro.getAttribute("aria-label") ?? quadro.getAttribute("aria-labelledby"),
    ).toBeTruthy();
    const aceite = await screen.findByRole("checkbox", { name: /de acordo/i });
    expect(aceite.getAttribute("id")).toBe("aceite-lgpd");
  });
});

describe("TermoConsentimento — corrida no registro (conflito Storage)", () => {  it("mapeia duplicate/already exists para termo-já-registrado", () => {
    const esperado = "Termo já registrado para este cliente.";
    expect(mapConsentimentoError(new Error("termo-ja-registrado"))).toBe(esperado);
    expect(mapConsentimentoError(new Error("Duplicate object, already exists"))).toBe(esperado);
    expect(mapConsentimentoError(new Error("The resource already exists"))).toBe(esperado);
    expect(mapConsentimentoError("duplicate key value")).toBe(esperado);
  });

  it("exibe termo-já-registrado quando o upload perde a corrida", async () => {
    const bucket = mockStorageUnsigned();
    bucket.upload.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: "Duplicate: already exists" } }),
    );
    renderTermo();
    fireEvent.click(await screen.findByRole("button", { name: /assinar termo/i }));
    fireEvent.change(await screen.findByLabelText(/nome completo/i), {
      target: { value: "Maria Silva" },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /de acordo/i }));
    fireEvent.click(await screen.findByRole("button", { name: /confirmar assinatura/i }));
    expect(await screen.findByText(/termo já registrado/i)).toBeTruthy();
  });
});
