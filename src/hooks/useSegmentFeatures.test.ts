// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";

const mocks = vi.hoisted(() => ({
  current: {
    tenant: { segment: "salao" } as unknown,
    isLoadingAuth: false,
    hasTenantError: false,
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mocks.current,
}));

beforeEach(() => {
  mocks.current = {
    tenant: { segment: "salao" },
    isLoadingAuth: false,
    hasTenantError: false,
  };
});

afterEach(cleanup);

describe("useSegmentFeatures — resolução do tenant", () => {
  it("com tenant resolvido deriva as features do segmento", () => {
    const { result } = renderHook(() => useSegmentFeatures());
    expect(result.current.payments).toBe(true);
    expect(result.current.combos).toBe(true);
  });

  it("durante o load da auth devolve payments=null (não resolvido)", () => {
    mocks.current.isLoadingAuth = true;
    const { result } = renderHook(() => useSegmentFeatures());
    expect(result.current.payments).toBeNull();
  });

  it("com erro de leitura do tenant devolve payments=null", () => {
    mocks.current.hasTenantError = true;
    const { result } = renderHook(() => useSegmentFeatures());
    expect(result.current.payments).toBeNull();
  });
});
