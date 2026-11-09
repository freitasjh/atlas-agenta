// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequireInternalOperator } from "@/internal-admin/RequireInternalOperator";
import type { InternalOperatorState } from "@/internal-admin/useInternalOperator";

const state = vi.hoisted(() => ({ current: { status: "loading" } as InternalOperatorState }));

vi.mock("@/internal-admin/useInternalOperator", () => ({
  useInternalOperator: () => state.current,
}));

function renderGuard(s: InternalOperatorState, entry = "/internal-admin") {
  state.current = s;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<RequireInternalOperator />}>
          <Route path="/internal-admin" element={<p>área interna</p>} />
        </Route>
        <Route path="/internal-admin/login" element={<p>tela de login interno</p>} />
        <Route path="/internal-admin/mfa" element={<p>tela de mfa</p>} />
        <Route path="/internal-admin/enroll" element={<p>tela de enroll</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("RequireInternalOperator", () => {
  it("operador com aal2 entra sem dado vazado", () => {
    renderGuard({ status: "allowed", userId: "op-1" });
    expect(screen.getByText("área interna")).toBeTruthy();
  });

  it("sem sessão vai para login sem renderizar dado", () => {
    renderGuard({ status: "unauthenticated" });
    expect(screen.getByText("tela de login interno")).toBeTruthy();
    expect(screen.queryByText("área interna")).toBeNull();
  });

  it("operador sem mfa cai no mfa sem dado", () => {
    renderGuard({ status: "mfa_required" });
    expect(screen.getByText("tela de mfa")).toBeTruthy();
    expect(screen.queryByText("área interna")).toBeNull();
  });

  it("operador sem factors cai no enroll sem dado nem loop", () => {
    renderGuard({ status: "enroll_required" }, "/internal-admin");
    expect(screen.getByText("tela de enroll")).toBeTruthy();
    expect(screen.queryByText("área interna")).toBeNull();
  });

  it("tenant/não-operador recebe 403 nomeado", () => {
    renderGuard({ status: "forbidden" });
    expect(screen.getByText("Acesso restrito")).toBeTruthy();
    expect(screen.queryByText("área interna")).toBeNull();
  });
});
