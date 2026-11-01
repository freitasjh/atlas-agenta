// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { router } from "@/router";

/**
 * Future flags do React Router 7 na casca de roteamento (ADR-14).
 *
 * Sem elas, cada carga da SPA emite 5 avisos de deprecação do
 * `createBrowserRouter`. O sexto (`v7_startTransition`) mora no `RouterProvider`
 * (`src/main.tsx`), que não é instanciado aqui.
 */
describe("router — future flags v7", () => {
  it("ativa os flags de deprecação do createBrowserRouter", () => {
    expect(router.future).toMatchObject({
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_relativeSplatPath: true,
      v7_skipActionErrorRevalidation: true,
    });
  });
});
