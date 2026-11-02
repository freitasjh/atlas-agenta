// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { router } from "@/router";

describe("AgendarPage route", () => {
  it("registra rota pública agendar/:token", () => {
    const routes = router.routes as { path?: string }[];
    const flat = JSON.stringify(routes);
    expect(flat).toContain("agendar/:token");
  });
});