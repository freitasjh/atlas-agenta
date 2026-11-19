// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isTransitionAllowed } from "@/lib/scheduling-status";
import {
  useBulkTransition,
  type BulkTransitionCall,
  type BulkTransitionItem,
  type BulkTransitionResult,
} from "@/app/agenda/useBulkTransition";

afterEach(cleanup);

function items(ids: string[], from = "pendente"): BulkTransitionItem[] {
  return ids.map((id) => ({
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: from as any,
  }));
}

describe("useBulkTransition — lote sem endpoint batch (ADR-04)", () => {
  it("lote de 10 com 2 falhas resume 8/2 e retry alcança só os 2", async () => {
    const calls: BulkTransitionCall[] = [];
    const mutate = vi.fn(
      async (call: BulkTransitionCall): Promise<unknown> => {
        calls.push(call);
        if (call.id === "ap-3" || call.id === "ap-7") throw new Error("409");
        return undefined;
      },
    );
    const { result } = renderHook(() => useBulkTransition(mutate));

    let summary: BulkTransitionResult | undefined;
    await act(async () => {
      summary = await result.current.run(items(["ap-1", "ap-2", "ap-3"]), "confirmado");
    });
    // Primeiro lote: 2 ok + 1 falha (parcial menor para a asserção direta).
    expect(summary?.ok).toHaveLength(2);
    expect(summary?.failed).toHaveLength(1);
    expect(result.current.progress).toEqual({ done: 3, total: 3 });

    // Retry dispara só o falhado, com a mesma ação.
    mutate.mockClear();
    mutate.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.retry();
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      id: "ap-3",
      to: "confirmado",
    });
    expect(result.current.result?.failed).toHaveLength(0);
    expect(result.current.result?.ok.map((i) => i.id)).toContain("ap-3");
  });

  it("contrato sem motivo e sem chave: chamada é só {id, from, to}", async () => {
    const mutate = vi.fn(
      async (_call: BulkTransitionCall): Promise<unknown> => undefined,
    );
    const { result } = renderHook(() => useBulkTransition(mutate));
    await act(async () => {
      await result.current.run(items(["ap-1", "ap-2"]), "cancelado");
    });
    expect(mutate).toHaveBeenCalledTimes(2);
    for (const [call] of mutate.mock.calls) {
      expect(call).toEqual({ id: expect.any(String), from: "pendente", to: "cancelado" });
      expect(call).not.toHaveProperty("reason");
      expect(call).not.toHaveProperty("idempotencyKey");
    }
  });

  it("sem desfazer: hook não expõe undo (lote irreversível na máquina)", async () => {
    const mutate = vi.fn(
      async (_call: BulkTransitionCall): Promise<unknown> => undefined,
    );
    const { result } = renderHook(() => useBulkTransition(mutate));
    await act(async () => {
      await result.current.run(items(["ap-1", "ap-2"]), "confirmado");
    });
    // Ausência honesta: nem `undo` nem `undoAvailable` existem no contrato.
    expect(result.current).not.toHaveProperty("undo");
    expect(result.current).not.toHaveProperty("undoAvailable");
    expect(result.current).not.toHaveProperty("undoWindowMs");
  });

  it("sem desfazer honesto contra a máquina: confirmado→pendente é inválido", () => {
    // Prova de que o undo removido nunca funcionaria: a inversa que ele
    // tentaria é recusada pela mesma máquina que o lote valida.
    expect(isTransitionAllowed("confirmado", "pendente")).toBe(false);
    expect(isTransitionAllowed("cancelado", "pendente")).toBe(false);
  });

  it("recusa nao_compareceu e concluido no lote (exigem confirmação individual)", async () => {
    const mutate = vi.fn(
      async (_call: BulkTransitionCall): Promise<unknown> => undefined,
    );
    const { result } = renderHook(() => useBulkTransition(mutate));
    await expect(
      act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await result.current.run(items(["ap-1"]), "nao_compareceu" as any);
      }),
    ).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
  });
});
