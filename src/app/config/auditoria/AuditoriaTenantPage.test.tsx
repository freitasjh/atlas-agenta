// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditoriaTenantPage } from "@/app/config/auditoria/AuditoriaTenantPage";
import { buildUserAuditCsv } from "@/app/config/auditoria/exportAuditCsv";
import type { UserAuditLogEntry } from "@/hooks/useUserAuditLog";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));

const ROWS = [
  {
    id: "u1",
    tenant_id: "t1",
    actor_id: "ator-1",
    action: "invitation.created",
    target_type: "invitation",
    target_id: "i1",
    metadata: {},
    created_at: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "u2",
    tenant_id: "t1",
    actor_id: "ator-2",
    action: "user.role_changed",
    target_type: "profile",
    target_id: "p1",
    metadata: {},
    created_at: "2026-11-02T10:00:00.000Z",
  },
];

function mockSuccess(rows: unknown = ROWS) {
  fromMock.mockReturnValue({
    select: () => ({
      in: () => {
        // biome-ignore lint/suspicious/noExplicitAny: cadeia dinâmica do mock.
        const chain: any = {};
        chain.gte = vi.fn(() => chain);
        chain.lte = vi.fn(() => chain);
        chain.order = vi.fn(() => ({
          limit: vi.fn(async () => ({ data: rows, error: null })),
        }));
        return chain;
      },
    }),
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AuditoriaTenantPage),
    ),
  );
}

beforeEach(() => {
  fromMock.mockReset();
  mockSuccess();
});

afterEach(() => {
  cleanup();
});

describe("AuditoriaTenantPage", () => {
  it("renderiza tabela com labels pt-BR (quando, ator, ação, alvo)", async () => {
    renderPage();
    expect((await screen.findAllByText("Convite enviado")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Papel alterado")).length).toBeGreaterThan(0);
    expect(screen.getByText("Quando")).toBeTruthy();
    expect(screen.getByText("Ator")).toBeTruthy();
    expect(screen.getAllByText("Ação").length).toBeGreaterThan(0);
    expect(screen.getByText("Alvo")).toBeTruthy();
  });

  it("busca por ator filtra a lista", async () => {
    renderPage();
    await screen.findAllByText("Convite enviado");
    fireEvent.change(screen.getByLabelText("Buscar por ator"), {
      target: { value: "ator-2" },
    });
    expect(screen.queryByText("Convite enviado")).toBeNull();
    expect((await screen.findAllByText("Papel alterado")).length).toBeGreaterThan(0);
  });

  it("filtra por ação", async () => {
    const { container } = renderPage();
    await screen.findAllByText("Convite enviado");
    const trigger = container.querySelector('[id="auditoria-acao"]');
    expect(trigger).toBeTruthy();
  });

  it("empty state quando nada corresponde", async () => {
    renderPage();
    await screen.findAllByText("Convite enviado");
    fireEvent.change(screen.getByLabelText("Buscar por ator"), {
      target: { value: "ninguem" },
    });
    expect(await screen.findByText("Nenhum registro encontrado")).toBeTruthy();
  });

  it("erro ⇒ StatePanel com retry", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        in: () => {
          // biome-ignore lint/suspicious/noExplicitAny: cadeia dinâmica do mock.
          const chain: any = {};
          chain.gte = vi.fn(() => chain);
          chain.lte = vi.fn(() => chain);
          chain.order = vi.fn(() => ({
            limit: vi.fn(async () => ({ data: null, error: { message: "rls" } })),
          }));
          return chain;
        },
      }),
    });
    renderPage();
    expect(
      await screen.findByText("Não foi possível carregar a auditoria"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeTruthy();
  });

  it("botão CSV desabilitado quando vazio + aviso de PII visível", async () => {
    mockSuccess([]);
    renderPage();
    await screen.findByText("Nenhum registro encontrado");
    expect(
      (screen.getByRole("button", { name: /exportar csv/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/dados pessoais/i)).toBeTruthy();
  });

  it("botão CSV habilitado com registros", async () => {
    renderPage();
    await screen.findAllByText("Convite enviado");
    expect(
      (screen.getByRole("button", { name: /exportar csv/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe("buildUserAuditCsv", () => {
  it("exporta o filtrado com BOM UTF-8 e cabeçalho pt-BR", () => {
    const csv = buildUserAuditCsv(ROWS as unknown as UserAuditLogEntry[]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("data;acao;ator;alvo");
    expect(csv).toContain("Convite enviado");
    expect(csv).toContain("Papel alterado");
  });

  it("escapa ponto-e-vírgula e aspas", () => {
    const row = {
      ...ROWS[0],
      actor_id: 'a;"b',
    } as unknown as UserAuditLogEntry;
    const csv = buildUserAuditCsv([row]);
    expect(csv).toContain('"a;""b"');
  });

  it("previne CSV formula injection (= + - @)", () => {
    const mk = (actor_id: string) =>
      ({ ...ROWS[0], actor_id }) as unknown as UserAuditLogEntry;
    for (const payload of ["=SUM(A1:A2)", "+1+1", "-1-1", "@x"]) {
      const csv = buildUserAuditCsv([mk(payload)]);
      expect(csv).toContain(`'${payload}`);
    }
  });
});
