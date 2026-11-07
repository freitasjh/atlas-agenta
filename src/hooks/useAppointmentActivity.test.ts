// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPOINTMENT_ACTIVITY_SELECT,
  useAppointmentActivityRange,
} from "@/hooks/useAppointments";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ data: { timezone: "America/Sao_Paulo" } }),
}));

/**
 * A6/A5: a busca de conflito/contagem usa colunas leves (sem join, sem PII)
 * e é escopada por profissional — nunca o tenant inteiro.
 */
describe("useAppointmentActivityRange — select leve + escopo (A6/A5)", () => {
  const rows = [
    {
      id: "a1",
      starts_at: "2026-11-10T17:00:00.000Z",
      ends_at: "2026-11-10T18:00:00.000Z",
      status: "confirmado",
    },
  ];
  let selectArg = "";
  let eqCalls: Array<[string, string]> = [];

  beforeEach(() => {
    fromMock.mockReset();
    selectArg = "";
    eqCalls = [];
    fromMock.mockImplementation(() => {
      const builder = {
        select: (columns: string) => {
          selectArg = columns;
          return builder;
        },
        gte: () => builder,
        lt: () => builder,
        order: () => builder,
        eq: (column: string, value: string) => {
          eqCalls.push([column, value]);
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return builder;
    });
  });

  afterEach(() => cleanup());

  function renderActivity() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return renderHook(
      () =>
        useAppointmentActivityRange({
          startDay: "2026-11-07",
          endDay: "2026-12-07",
          professionalId: "prof-9",
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    );
  }

  it("select leve: só id/starts_at/ends_at/status (sem join de cliente/serviço)", async () => {
    const { result } = renderActivity();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(selectArg).toBe(APPOINTMENT_ACTIVITY_SELECT);
    expect(selectArg).toBe("id, starts_at, ends_at, status");
    expect(selectArg).not.toMatch(/customers|services|professionals/);
    expect(result.current.data).toHaveLength(1);
  });

  it("escopo por profissional: eq(professional_id) sem tenant_id no filtro", async () => {
    const { result } = renderActivity();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqCalls).toContainEqual(["professional_id", "prof-9"]);
    expect(eqCalls.some(([column]) => column === "tenant_id")).toBe(false);
  });
});
