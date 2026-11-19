// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConciliarLote } from "@/hooks/useConciliacao";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const TARGET = {
  alvo_tipo: "payable",
  alvo_id: "55555555-5555-4555-8555-555555555555",
  descricao: "Aluguel do salão",
  valor_cents: 15_000,
  data: "2026-01-05",
  delta_dias: 0,
  score: 100,
};

const OUTRO_TARGET = {
  ...TARGET,
  alvo_id: "66666666-6666-4666-8666-666666666666",
  data: "2026-01-06",
  delta_dias: 1,
  score: 90,
};

function sugestao(bankLineId: string, candidatos: unknown[]) {
  return {
    data: {
      bank_line_id: bankLineId,
      valor_cents: -15_000,
      data: "2026-01-05",
      tolerancia_dias: 2,
      candidatos,
    },
    error: null,
  };
}

function renderLote() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(() => useConciliarLote(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

describe("useConciliarLote — dedupe de alvo no lote", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("duas linhas com o MESMO candidato → 1 link e 1 sem_match (lote não aborta)", async () => {
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "reconciliation_suggest_matches") {
        return Promise.resolve(sugestao(args.p_bank_line_id as string, [TARGET]));
      }
      return Promise.resolve({ data: { linked: 1, link_ids: ["link-1"] }, error: null });
    });

    const { result } = renderLote();
    const out = await result.current.mutateAsync(["linha-1", "linha-2"]);

    expect(out).toEqual({ linked: 1, sem_match: 1, link_ids: ["link-1"] });
    expect(rpcMock).toHaveBeenCalledWith("reconciliation_link", {
      p_links: [
        { bank_line_id: "linha-1", alvo_tipo: "payable", alvo_id: TARGET.alvo_id },
      ],
    });
  });

  it("segunda linha pega o próximo candidato livre quando existe", async () => {
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "reconciliation_suggest_matches") {
        return Promise.resolve(
          sugestao(args.p_bank_line_id as string, [TARGET, OUTRO_TARGET]),
        );
      }
      return Promise.resolve({ data: { linked: 2, link_ids: ["link-1", "link-2"] }, error: null });
    });

    const { result } = renderLote();
    const out = await result.current.mutateAsync(["linha-1", "linha-2"]);

    expect(out).toEqual({ linked: 2, sem_match: 0, link_ids: ["link-1", "link-2"] });
    expect(rpcMock).toHaveBeenCalledWith("reconciliation_link", {
      p_links: [
        { bank_line_id: "linha-1", alvo_tipo: "payable", alvo_id: TARGET.alvo_id },
        { bank_line_id: "linha-2", alvo_tipo: "payable", alvo_id: OUTRO_TARGET.alvo_id },
      ],
    });
  });

  it("linha sem candidato conta sem_match e nada é linkado", async () => {
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "reconciliation_suggest_matches") {
        return Promise.resolve(sugestao(args.p_bank_line_id as string, []));
      }
      return Promise.resolve({ data: { linked: 0, link_ids: [] }, error: null });
    });

    const { result } = renderLote();
    const out = await result.current.mutateAsync(["linha-1"]);

    expect(out).toEqual({ linked: 0, sem_match: 1, link_ids: [] });
    expect(rpcMock).not.toHaveBeenCalledWith("reconciliation_link", expect.anything());
  });
});
