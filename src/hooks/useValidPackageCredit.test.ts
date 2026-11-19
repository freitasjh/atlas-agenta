// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { hasValidPackageCredit } from "@/hooks/useValidPackageCredit";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

function row(overrides: Record<string, unknown> = {}) {
  return {
    credit_id: "cr-1",
    service_id: "s-1",
    total_sessions: 5,
    used_sessions: 2,
    remaining: 3,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    expired: false,
    status: "active",
    ...overrides,
  };
}

describe("hasValidPackageCredit — guard pré-capture (anti-dupla-cobrança)", () => {
  it("true com crédito válido para o serviço", async () => {
    rpcMock.mockResolvedValueOnce({ data: [row()], error: null });
    await expect(hasValidPackageCredit("c-1", "s-1")).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("get_package_balance", {
      p_customer_id: "c-1",
    });
  });

  it("false quando o crédito é de outro serviço", async () => {
    rpcMock.mockResolvedValueOnce({ data: [row()], error: null });
    await expect(hasValidPackageCredit("c-1", "s-2")).resolves.toBe(false);
  });

  it("false com crédito vencido, esgotado ou zerado", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        row({ expired: true }),
        row({ credit_id: "cr-2", status: "exhausted", remaining: 0 }),
        row({ credit_id: "cr-3", remaining: 0 }),
      ],
      error: null,
    });
    await expect(hasValidPackageCredit("c-1", "s-1")).resolves.toBe(false);
  });

  it("false sem cliente/serviço (sem request) e em erro de rede/shape", async () => {
    rpcMock.mockClear();
    await expect(hasValidPackageCredit(null, "s-1")).resolves.toBe(false);
    await expect(hasValidPackageCredit("c-1", null)).resolves.toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValueOnce({ data: null, error: new Error("rede") });
    await expect(hasValidPackageCredit("c-1", "s-1")).resolves.toBe(false);

    rpcMock.mockResolvedValueOnce({ data: [{ lixo: true }], error: null });
    await expect(hasValidPackageCredit("c-1", "s-1")).resolves.toBe(false);
  });
});
