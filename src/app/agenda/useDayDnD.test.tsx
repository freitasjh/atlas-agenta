// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAppointments", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/hooks/useAppointments")>();
  return {
    ...original,
    useUpdateAppointment: () => ({
      mutateAsync: mocks.mutateAsync,
      isPending: false,
    }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: (...args: unknown[]) => {
      mocks.toastError(...args);
      return "toast-id";
    },
  },
}));

import { useDayDnD } from "@/app/agenda/useDayDnD";
import type { AppointmentWithRelations } from "@/types/domain";

afterEach(() => {
  cleanup();
  mocks.mutateAsync.mockReset();
  mocks.toastSuccess.mockClear();
  mocks.toastError.mockClear();
});

const APPOINTMENT = {
  id: "ap-1",
  customer_id: "c-1",
  professional_id: "pr-1",
  service_id: "s-1",
  combo_id: null,
  starts_at: "2026-11-10T12:00:00.000Z",
  ends_at: "2026-11-10T13:00:00.000Z",
  price_cents: 10000,
  status: "pendente",
} as unknown as AppointmentWithRelations;

function renderDnD() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return renderHook(() => useDayDnD({ day: "2026-11-10", timeZone: "America/Sao_Paulo" }), {
    wrapper,
  });
}

describe("useDayDnD", () => {
  it("move persiste com starts_at/ends_at preservando a duração", async () => {
    mocks.mutateAsync.mockResolvedValueOnce(APPOINTMENT);
    const { result } = renderDnD();
    let moved = false;
    await act(async () => {
      moved = await result.current.move(APPOINTMENT, 630);
    });
    expect(moved).toBe(true);
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    const payload = mocks.mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe("ap-1");
    // 10:30–11:30 BRT.
    expect(payload.startsAt).toBe("2026-11-10T13:30:00.000Z");
    expect(payload.endsAt).toBe("2026-11-10T14:30:00.000Z");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining("10:30"),
    );
  });

  it("conflito 409 retorna false, anuncia recovery e mantém origem", async () => {
    mocks.mutateAsync.mockRejectedValueOnce({ code: "23P01" });
    const { result } = renderDnD();
    let moved = true;
    await act(async () => {
      moved = await result.current.move(APPOINTMENT, 630);
    });
    expect(moved).toBe(false);
    expect(mocks.toastError).toHaveBeenCalled();
    const [title, options] = mocks.toastError.mock.calls[0] as [
      string,
      { description?: string; action?: { label: string } },
    ];
    expect(title).toMatch(/horário/);
    expect(options.description).toMatch(/origem/);
    expect(options.action?.label).toBe("Ver conflito");
    expect(result.current.announcement).toMatch(/Conflito/);
  });

  it("só permite soltar no mesmo profissional (intra-dia)", () => {
    const { result } = renderDnD();
    act(() => {
      result.current.startDrag(APPOINTMENT);
    });
    expect(result.current.canDropOn("pr-1", false)).toBe(true);
    expect(result.current.canDropOn("pr-2", false)).toBe(false);
    // Visão de coluna única (própria agenda): aceita.
    expect(result.current.canDropOn(null, true)).toBe(true);
    // Sem arrasto ativo: recusa tudo.
    act(() => {
      result.current.endDrag();
    });
    expect(result.current.canDropOn("pr-1", false)).toBe(false);
  });
});
