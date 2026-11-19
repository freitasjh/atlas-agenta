// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  BULK_SELECTION_LIMIT,
  useBulkSelection,
} from "@/app/agenda/useBulkSelection";

afterEach(cleanup);

describe("useBulkSelection — seleção de lote (ADR-04)", () => {
  it("alterna seleção por id", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggle("ap-1"));
    expect(result.current.isSelected("ap-1")).toBe(true);
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle("ap-1"));
    expect(result.current.isSelected("ap-1")).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("bloqueia o 51º item com mensagem de limite", () => {
    const { result } = renderHook(() => useBulkSelection());
    const ids = Array.from({ length: 50 }, (_, i) => `ap-${i}`);
    act(() => result.current.selectAll(ids));
    expect(result.current.count).toBe(50);
    expect(result.current.limitHit).toBe(false);

    act(() => result.current.toggle("ap-51"));
    expect(result.current.isSelected("ap-51")).toBe(false);
    expect(result.current.count).toBe(50);
    expect(result.current.limitHit).toBe(true);
  });

  it("selectAll com mais de 50 mantém só os 50 primeiros e sinaliza limite", () => {
    const { result } = renderHook(() => useBulkSelection());
    const ids = Array.from({ length: 60 }, (_, i) => `ap-${i}`);
    act(() => result.current.selectAll(ids));
    expect(result.current.count).toBe(BULK_SELECTION_LIMIT);
    expect(result.current.selectedIds).toHaveLength(50);
    expect(result.current.limitHit).toBe(true);
  });

  it("limpar esvazia a seleção e o aviso de limite", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.selectAll(["ap-1", "ap-2"]));
    act(() => result.current.toggle("ap-3"));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.limitHit).toBe(false);
  });

  it("desselecionar libera espaço e limpa o aviso", () => {
    const { result } = renderHook(() => useBulkSelection());
    const ids = Array.from({ length: 50 }, (_, i) => `ap-${i}`);
    act(() => result.current.selectAll(ids));
    act(() => result.current.toggle("ap-51"));
    expect(result.current.limitHit).toBe(true);
    act(() => result.current.toggle("ap-0"));
    expect(result.current.limitHit).toBe(false);
    act(() => result.current.toggle("ap-51"));
    expect(result.current.isSelected("ap-51")).toBe(true);
  });
});
