// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  draftKey,
  useAppointmentDraft,
  type AppointmentDraft,
} from "@/app/agenda/useAppointmentDraft";

const DRAFT: AppointmentDraft = {
  customerId: "c-1",
  professionalId: "p-1",
  selection: { kind: "service", serviceId: "s-1" },
  date: "2026-11-10",
  time: "09:30",
};

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // stub sem clear: ignora.
  }
});

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  });
});

describe("useAppointmentDraft", () => {
  it("monta chave por tenant + dia", () => {
    expect(draftKey("t-1", "2026-11-10")).toBe(
      "atlas-agenda:appointment-draft:t-1:2026-11-10",
    );
    expect(draftKey("t-1", "2026-11-10")).not.toBe(
      draftKey("t-1", "2026-11-11"),
    );
    expect(draftKey("t-1", "2026-11-10")).not.toBe(
      draftKey("t-2", "2026-11-10"),
    );
  });

  it("salva e restaura o rascunho (sobrevive a reload)", () => {
    const { result, unmount } = renderHook(() =>
      useAppointmentDraft("t-1", "2026-11-10"),
    );
    act(() => {
      result.current.save(DRAFT);
    });
    expect(result.current.hasDraft).toBe(true);
    unmount();

    // "Reload": novo mount lê a mesma chave.
    const { result: reloaded } = renderHook(() =>
      useAppointmentDraft("t-1", "2026-11-10"),
    );
    expect(reloaded.current.hasDraft).toBe(true);
    expect(reloaded.current.draft).toEqual(DRAFT);
  });

  it("limpa o rascunho ao salvar/descartar", () => {
    const { result } = renderHook(() =>
      useAppointmentDraft("t-1", "2026-11-10"),
    );
    act(() => {
      result.current.save(DRAFT);
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(window.localStorage.getItem(draftKey("t-1", "2026-11-10"))).toBeNull();
  });

  it("ignora JSON corrompido sem quebrar", () => {
    window.localStorage.setItem(draftKey("t-1", "2026-11-10"), "{invalido");
    const { result } = renderHook(() =>
      useAppointmentDraft("t-1", "2026-11-10"),
    );
    expect(result.current.draft).toBeNull();
    expect(result.current.hasDraft).toBe(false);
  });

  it("sem tenant não lê nem escreve", () => {
    const { result } = renderHook(() => useAppointmentDraft(null, "2026-11-10"));
    act(() => {
      result.current.save(DRAFT);
    });
    expect(result.current.draft).toBeNull();
    expect(result.current.hasDraft).toBe(false);
  });

  it("tenant-tardio-relê-draft: relê quando a chave muda após mount", () => {
    window.localStorage.setItem(
      draftKey("t-1", "2026-11-10"),
      JSON.stringify(DRAFT),
    );
    const { result, rerender } = renderHook(
      ({ tenantId }: { tenantId: string | null }) =>
        useAppointmentDraft(tenantId, "2026-11-10"),
      { initialProps: { tenantId: null as string | null } },
    );
    expect(result.current.draft).toBeNull();
    rerender({ tenantId: "t-1" });
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draft).toEqual(DRAFT);
  });
});
