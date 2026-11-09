// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import {
  LEGACY_ADMIN_REDIRECT_MAP,
  LegacyAdminRedirect,
  LegacyTenantPlanoRedirect,
} from "@/internal-admin/LegacyAdminRedirect";

function renderAt(entry: string, routePath: string, element: ReactNode): () => string {
  let seen = "";
  function Spy() {
    seen = useLocation().pathname;
    return null;
  }
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={routePath} element={<>{element}</>} />
        <Route path="*" element={<Spy />} />
      </Routes>
    </MemoryRouter>,
  );
  return () => seen;
}

afterEach(() => cleanup());

describe("LegacyAdminRedirect — mapa release 1 (VAL-01)", () => {
  it("declara os 8 pares /admin/* → /internal-admin/*", () => {
    expect(LEGACY_ADMIN_REDIRECT_MAP).toEqual({
      "/admin": "/internal-admin",
      "/admin/empresas": "/internal-admin/empresas",
      "/admin/tenants/:id/plano": "/internal-admin/tenants/:id/plano",
      "/admin/assinaturas": "/internal-admin/assinaturas",
      "/admin/metricas": "/internal-admin/metricas",
      "/admin/dashboard": "/internal-admin/dashboard",
      "/admin/convites": "/internal-admin/convites",
      "/admin/auditoria": "/internal-admin/auditoria",
    });
  });

  it.each([
    ["/admin/empresas", "/admin/empresas", "/internal-admin/empresas"],
    ["/admin/assinaturas", "/admin/assinaturas", "/internal-admin/assinaturas"],
    ["/admin/metricas", "/admin/metricas", "/internal-admin/metricas"],
    ["/admin/dashboard", "/admin/dashboard", "/internal-admin/dashboard"],
    ["/admin/convites", "/admin/convites", "/internal-admin/convites"],
    ["/admin/auditoria", "/admin/auditoria", "/internal-admin/auditoria"],
  ])("redirect %s → %s", (entry, routePath, expected) => {
    const seen = renderAt(entry, routePath, <LegacyAdminRedirect to={expected} />);
    expect(seen()).toBe(expected);
  });

  it("redirect /admin/tenants/:id/plano preserva o id válido", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const seen = renderAt(
      `/admin/tenants/${id}/plano`,
      "/admin/tenants/:id/plano",
      <LegacyTenantPlanoRedirect />,
    );
    expect(seen()).toBe(`/internal-admin/tenants/${id}/plano`);
  });

  it("id inválido cai em /internal-admin/empresas sem query", () => {
    const seen = renderAt(
      "/admin/tenants/nao-uuid/plano",
      "/admin/tenants/:id/plano",
      <LegacyTenantPlanoRedirect />,
    );
    expect(seen()).toBe("/internal-admin/empresas");
  });
});
