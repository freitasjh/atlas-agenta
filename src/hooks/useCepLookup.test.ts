// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCepLookup } from "@/hooks/useCepLookup";

/**
 * FE-03 — `useCepLookup` (ADR-003): ViaCEP como sugestão, nunca autoridade.
 *
 * Debounce 400ms + AbortController com timeout de 5s; redigitar aborta a
 * anterior; estados idle/loading/success/not-found/error; retry repete o último
 * CEP. Fetch global mockado: nenhuma rede. Nenhum dado real.
 */

const VIA_CEP_OK = {
  cep: "01310-100",
  logradouro: "Avenida Paulista",
  localidade: "São Paulo",
  uf: "SP",
};

function mockFetchOnce(payload: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe("useCepLookup — debounce e estados", () => {
  it("começa idle sem endereço", () => {
    const { result } = renderHook(() => useCepLookup());
    expect(result.current.status).toBe("idle");
    expect(result.current.address).toBeNull();
  });

  it("CEP incompleto não dispara fetch", async () => {
    const fetchMock = mockFetchOnce(VIA_CEP_OK);
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310");
    });
    await flushDebounce();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("8 dígitos → loading → success com endereço", async () => {
    mockFetchOnce(VIA_CEP_OK);
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310100");
    });
    expect(result.current.status).toBe("idle");

    await flushDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("success");
    expect(result.current.address).toEqual({
      street: "Avenida Paulista",
      city: "São Paulo",
      state: "SP",
    });
  });

  it("aceita CEP mascarado (strip antes do fetch)", async () => {
    const fetchMock = mockFetchOnce(VIA_CEP_OK);
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310-100");
    });
    await flushDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/01310100/json/");
    expect(result.current.status).toBe("success");
  });

  it('{"erro": true} → not-found, sem endereço', async () => {
    mockFetchOnce({ erro: "true" });
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("99999999");
    });
    await flushDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("not-found");
    expect(result.current.address).toBeNull();
  });

  it("falha de rede → error, sem endereço", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310100");
    });
    await flushDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.address).toBeNull();
  });
});

describe("useCepLookup — abort e retry", () => {
  it("redigitar aborta a requisição anterior", async () => {
    const aborts: string[] = [];
    const fetchMock = vi.fn().mockImplementation(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborts.push(String(url));
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310100");
    });
    await flushDebounce();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.lookup("20040000");
    });
    await flushDebounce();

    expect(aborts).toHaveLength(1);
    expect(aborts[0]).toContain("/01310100/json/");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retry repete o último CEP após erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310100");
    });
    await flushDebounce();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("error");

    const fetchMock = mockFetchOnce(VIA_CEP_OK);
    act(() => {
      result.current.retry();
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("success");
  });

  it("reset volta a idle", async () => {
    mockFetchOnce(VIA_CEP_OK);
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310100");
    });
    await flushDebounce();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("success");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.address).toBeNull();
  });

  it("timeout de 5s ⇒ error com retry visível", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310100");
    });
    await flushDebounce();
    expect(result.current.status).toBe("loading");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.address).toBeNull();

    const retryMock = mockFetchOnce(VIA_CEP_OK);
    act(() => {
      result.current.retry();
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      await Promise.resolve();
    });

    expect(retryMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("success");
  });

  it("abort por redigitação ⇒ silencioso (sem error)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>(() => {
            // pendente para sempre: status deve ficar loading, nunca error
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCepLookup());

    act(() => {
      result.current.lookup("01310100");
    });
    await flushDebounce();
    expect(result.current.status).toBe("loading");

    act(() => {
      result.current.lookup("20040000");
    });
    await flushDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("loading");
    expect(result.current.address).toBeNull();
  });
});
