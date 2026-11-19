// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, roleMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  roleMock: { value: "receptionist" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: roleMock.value === "admin",
    isReceptionist: roleMock.value === "receptionist",
    isProfessional: roleMock.value === "professional",
    canManageCustomers: roleMock.value !== "professional",
    canViewFinancials: roleMock.value === "admin",
    canSendWhatsAppMessage: true,
  }),
}));

import { useCustomerHistory, useCustomerNotes } from "@/hooks/useCustomerCrm";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Cadeia PostgREST mínima: captura o `select`, resolve no terminal. */
function tableBuilder(finalData: unknown) {
  let selectArg = "";
  const builder: Record<string, (...args: never[]) => unknown> = {};
  builder.select = ((columns: string) => {
    selectArg = columns;
    return builder;
  }) as never;
  builder.eq = (() => builder) as never;
  builder.order = (() => builder) as never;
  builder.limit = (() => Promise.resolve({ data: finalData, error: null })) as never;
  builder.range = (() => Promise.resolve({ data: finalData, error: null })) as never;
  builder.maybeSingle = (() => Promise.resolve({ data: finalData, error: null })) as never;
  return { builder, getSelect: () => selectArg };
}

afterEach(() => cleanup());

describe("useCustomerHistory — sem vazamento financeiro (RF-26)", () => {
  const rpcItem = {
    id: "a1",
    starts_at: "2026-09-01T10:00:00.000Z",
    status: "concluido",
    service_name: "Corte",
    professional_id: "p1",
    price_cents: null,
  };

  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    roleMock.value = "receptionist";
  });

  it("receptionist: usa RPC customer_history e priceCents chega null", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "customer_history") {
        return Promise.resolve({
          data: { customer_id: "c1", page: 1, page_size: 20, total: 1, items: [rpcItem] },
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    // Enriquecimento de nomes de profissionais (lookup sem financeiro).
    const { builder } = tableBuilder([{ id: "p1", name: "João" }]);
    fromMock.mockImplementation(() => builder);

    const { result } = renderHook(() => useCustomerHistory("c1"), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith(
      "customer_history",
      expect.objectContaining({ p_customer_id: "c1" }),
    );
    // A tabela de atendimentos NUNCA é lida direto neste caminho (sem price_cents no fio).
    expect(fromMock).not.toHaveBeenCalledWith("appointments");
    expect(result.current.data?.[0]).toMatchObject({ id: "a1", priceCents: null });
  });

  it("receptionist em fallback (sem RPC): select direto omite price_cents", async () => {
    rpcMock.mockRejectedValue(new Error("RPC ausente"));
    const { builder, getSelect } = tableBuilder([]);
    fromMock.mockImplementation(() => builder);

    const { result } = renderHook(() => useCustomerHistory("c1"), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("appointments");
    expect(getSelect()).not.toContain("price_cents");
  });

  it("admin em fallback (sem RPC): select direto inclui price_cents", async () => {
    roleMock.value = "admin";
    rpcMock.mockRejectedValue(new Error("RPC ausente"));
    const { builder, getSelect } = tableBuilder([
      {
        id: "a1",
        starts_at: "2026-09-01T10:00:00.000Z",
        status: "concluido",
        price_cents: 15000,
        services: { name: "Corte" },
        professionals: { name: "João" },
      },
    ]);
    fromMock.mockImplementation(() => builder);

    const { result } = renderHook(() => useCustomerHistory("c1"), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getSelect()).toContain("price_cents");
    expect(result.current.data?.[0]).toMatchObject({ id: "a1", priceCents: 15000 });
  });
});

describe("useCustomerNotes — preserva professional do atendimento (RF-28)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    roleMock.value = "professional";
  });

  it("expõe appointmentProfessionalId para o gating de professional", async () => {
    const { builder } = tableBuilder([
      {
        id: "n2",
        customer_id: "c1",
        author_role: "professional",
        visibility: "appointment",
        appointment_id: "a1",
        body: "Nota do atendimento.",
        created_at: "2026-09-02T10:00:00.000Z",
        appointments: { professional_id: "p1" },
      },
    ]);
    fromMock.mockImplementation(() => builder);

    const { result } = renderHook(() => useCustomerNotes("c1"), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]).toMatchObject({
      id: "n2",
      appointmentProfessionalId: "p1",
    });
  });
});
