// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useSaveWorkingHours,
  WORKING_HOURS_DUPLICATE_MESSAGE,
  type WorkingHourDraft,
} from "@/hooks/useWorkingHours";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));

/** Snapshot prévio no banco (retornado pelo select inicial). */
const PREVIOUS = [
  {
    weekday: 1,
    start_time: "09:00:00",
    end_time: "18:00:00",
    break_start: null,
    break_end: null,
  },
];

const NEW_DAYS: WorkingHourDraft[] = [
  {
    weekday: 2,
    start_time: "08:00",
    end_time: "17:00",
    break_start: null,
    break_end: null,
  },
];

/**
 * Builder encadeado do supabase mockado. Ordem de chamadas na mutation:
 * select(previo) → delete → insert(novo) → [rollback] delete → insert(restore)…
 * `insertResults`/`deleteResults` configuram o erro de cada chamada, em ordem.
 */
function wireSupabase(opts: {
  insertResults: Array<{ error: unknown }>;
  deleteErrors?: Array<unknown>;
}) {
  let insertIndex = 0;
  let deleteIndex = 0;
  const insertCalls: unknown[][] = [];
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: async () => ({ data: PREVIOUS, error: null }),
    }),
    delete: () => ({
      eq: async () => ({
        error: opts.deleteErrors?.[deleteIndex++] ?? null,
      }),
    }),
    insert: (rows: unknown[]) => {
      insertCalls.push(rows);
      const result = opts.insertResults[insertIndex++] ?? { error: null };
      return Promise.resolve(result);
    },
  }));
  return { insertCalls };
}

function renderSave() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const { result } = renderHook(() => useSaveWorkingHours("prof-1"), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return result;
}

describe("useSaveWorkingHours — rollback com checagem de erro (C3)", () => {
  beforeEach(() => {
    fromMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("insert 23505 = semana prévia restaurada (delete+insert do snapshot)", async () => {
    const { insertCalls } = wireSupabase({
      insertResults: [{ error: { code: "23505" } }, { error: null }],
    });
    const result = renderSave();

    await expect(result.current.mutateAsync(NEW_DAYS)).rejects.toThrow(
      WORKING_HOURS_DUPLICATE_MESSAGE,
    );

    expect(insertCalls).toHaveLength(2);
    // 2ª chamada (restore) carrega a semana prévia, sem tenant_id no corpo.
    const restoreRows = insertCalls[1] as Array<Record<string, unknown>>;
    expect(restoreRows).toHaveLength(1);
    expect(restoreRows[0]).toMatchObject({ weekday: 1, professional_id: "prof-1" });
    expect(restoreRows[0]).not.toHaveProperty("tenant_id");
  });

  it("falha de insert no restore = retenta 1x e succeed", async () => {
    const { insertCalls } = wireSupabase({
      insertResults: [
        { error: { code: "23505" } },
        { error: { message: "falha transitória" } },
        { error: null }, // retry
      ],
    });
    const result = renderSave();

    await expect(result.current.mutateAsync(NEW_DAYS)).rejects.toThrow(
      WORKING_HOURS_DUPLICATE_MESSAGE,
    );
    // 1 insert novo + 2 tentativas de restore.
    expect(insertCalls).toHaveLength(3);
  });

  it("restore falha 2x = erro explícito 'guarde snapshot' + log", async () => {
    wireSupabase({
      insertResults: [
        { error: { code: "23505" } },
        { error: { message: "boom" } },
        { error: { message: "boom de novo" } },
      ],
    });
    const result = renderSave();

    await expect(result.current.mutateAsync(NEW_DAYS)).rejects.toThrow(
      /snapshot/i,
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("delete do rollback com erro = retentar e erro explícito se persistir", async () => {
    wireSupabase({
      insertResults: [{ error: { code: "23505" } }],
      deleteErrors: [null, { message: "delete falhou 1" }, { message: "delete falhou 2" }],
    });
    const result = renderSave();

    await expect(result.current.mutateAsync(NEW_DAYS)).rejects.toThrow(
      /snapshot/i,
    );
  });

  it("erro de insert não-23505 também restaura e relança o original", async () => {
    const { insertCalls } = wireSupabase({
      insertResults: [{ error: { message: "rede caiu" } }, { error: null }],
    });
    const result = renderSave();

    await expect(result.current.mutateAsync(NEW_DAYS)).rejects.toThrow(
      "rede caiu",
    );
    expect(insertCalls).toHaveLength(2);
  });
});
