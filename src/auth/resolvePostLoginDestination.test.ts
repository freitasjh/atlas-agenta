import { describe, expect, it } from "vitest";

import {
  isInternalPath,
  resolvePostLoginDestination,
} from "@/auth/resolvePostLoginDestination";

/**
 * Contrato de `resolvePostLoginDestination` (ADR-08): o destino pós-login vem
 * só das claims da sessão — nenhuma leitura de `profiles`.
 *
 * Ordem das regras (a primeira que casa vence):
 * 1. `mustChangePassword === true` → `/trocar-senha` (sempre primeiro);
 * 2. `super_admin` → `/admin/empresas` (`from` não muda o destino dele);
 * 3. sem claims (`role` nulo) → `/app` (os guards negam o acesso depois);
 * 4. demais papéis → `from` se for caminho interno válido, senão `/app`.
 */

describe("resolvePostLoginDestination", () => {
  describe("troca de senha obrigatória", () => {
    it("flag ligado com from válido ⇒ /trocar-senha (flag vence o from)", () => {
      const destination = resolvePostLoginDestination({
        role: "admin",
        mustChangePassword: true,
        from: "/app/agenda",
      });

      expect(destination).toBe("/trocar-senha");
    });

    it("flag ligado sem from ⇒ /trocar-senha", () => {
      const destination = resolvePostLoginDestination({
        role: "professional",
        mustChangePassword: true,
      });

      expect(destination).toBe("/trocar-senha");
    });

    it("flag ligado vence o papel super_admin", () => {
      const destination = resolvePostLoginDestination({
        role: "super_admin",
        mustChangePassword: true,
        from: "/admin/empresas",
      });

      expect(destination).toBe("/trocar-senha");
    });
  });

  describe("super admin com flag limpo", () => {
    it("vai para /admin/empresas", () => {
      const destination = resolvePostLoginDestination({
        role: "super_admin",
        mustChangePassword: false,
      });

      expect(destination).toBe("/admin/empresas");
    });

    it("from de tenant não desvia o super admin do painel", () => {
      const destination = resolvePostLoginDestination({
        role: "super_admin",
        mustChangePassword: false,
        from: "/app/agenda",
      });

      expect(destination).toBe("/admin/empresas");
    });
  });

  describe("papéis de tenant", () => {
    it("admin com from válido (pathname + search) respeita a origem", () => {
      const destination = resolvePostLoginDestination({
        role: "admin",
        mustChangePassword: false,
        from: "/app/agenda?date=2026-10-31",
      });

      expect(destination).toBe("/app/agenda?date=2026-10-31");
    });

    it("professional com from restrito cai no destino padrão", () => {
      const destination = resolvePostLoginDestination({
        role: "professional",
        mustChangePassword: false,
        from: "/app/cobrancas",
      });

      expect(destination).toBe("/app/agenda");
    });

    it("professional com from permitido respeita a origem", () => {
      const destination = resolvePostLoginDestination({
        role: "professional",
        mustChangePassword: false,
        from: "/app/clientes",
      });

      expect(destination).toBe("/app/clientes");
    });

    it("receptionist com from de horários respeita a origem (alinhado ao router)", () => {
      const destination = resolvePostLoginDestination({
        role: "receptionist",
        mustChangePassword: false,
        from: "/app/config/profissionais/abc-123/horarios",
      });

      expect(destination).toBe("/app/config/profissionais/abc-123/horarios");
    });

    it("receptionist com from da lista de profissionais cai no padrão", () => {
      const destination = resolvePostLoginDestination({
        role: "receptionist",
        mustChangePassword: false,
        from: "/app/config/profissionais",
      });

      expect(destination).toBe("/app/agenda");
    });

    it("professional com from de horários respeita a origem", () => {
      const destination = resolvePostLoginDestination({
        role: "professional",
        mustChangePassword: false,
        from: "/app/config/profissionais/abc-123/horarios",
      });

      expect(destination).toBe("/app/config/profissionais/abc-123/horarios");
    });

    it("admin sem from ⇒ /app", () => {
      const destination = resolvePostLoginDestination({
        role: "admin",
        mustChangePassword: false,
      });

      expect(destination).toBe("/app");
    });

    it.each([
      ["//evil.com", "protocol-relative"],
      ["https://evil.com", "URL absoluta"],
      ["http://evil.com/app", "URL absoluta com path"],
      ["/\\evil.com", "barra invertida"],
      ["app/agenda", "caminho relativo"],
      ["", "string vazia"],
      ["/\t/evil.com", "TAB removido pelo navegador"],
      ["/\n//evil.com", "LF removido pelo navegador"],
      ["/\u0000/evil.com", "NUL removido pelo navegador"],
    ])("admin com from inválido (%s, %s) ⇒ /app", (from) => {
      const destination = resolvePostLoginDestination({
        role: "admin",
        mustChangePassword: false,
        from,
      });

      expect(destination).toBe("/app");
    });
  });

  describe("sem claims", () => {
    it("role nulo sem from ⇒ /app", () => {
      const destination = resolvePostLoginDestination({
        role: null,
        mustChangePassword: false,
      });

      expect(destination).toBe("/app");
    });

    it("role nulo ignora from válido ⇒ /app (guard decide depois)", () => {
      const destination = resolvePostLoginDestination({
        role: null,
        mustChangePassword: false,
        from: "/app/agenda",
      });

      expect(destination).toBe("/app");
    });
  });
});

describe("isInternalPath", () => {
  it.each(["/", "/app", "/app/agenda?date=2026-10-31", "/admin/empresas"])(
    "%s é caminho interno",
    (from) => {
      expect(isInternalPath(from)).toBe(true);
    },
  );

  it.each([
    "//evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
    "app",
    "",
    null,
    undefined,
    42,
    "/\t/evil.com",
    "/\n//evil.com",
    "/\u0000/evil.com",
  ])("%s não é caminho interno", (from) => {
    expect(isInternalPath(from)).toBe(false);
  });
});
