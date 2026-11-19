// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProntuarioTab } from "@/app/agenda/prontuario/ProntuarioTab";

const { fromMock, storageFromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  storageFromMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock, storage: { from: storageFromMock } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const V1 = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "t-1",
  customer_id: C_ID,
  appointment_id: AP_ID,
  supersedes_id: null,
  allergies: "Penicilina",
  medications: "Losartana",
  clinical_notes: "Primeira consulta.",
  created_by: "u-1",
  created_at: "2026-11-10T12:00:00.000Z",
};

function mockList(rows: unknown[]) {
  fromMock.mockImplementation(() => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => Promise.resolve({ data: rows, error: null }),
    };
    return builder;
  });
}

function mockInsertCapture(captured: { payload: unknown }) {
  fromMock.mockImplementation(() => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => Promise.resolve({ data: [V1], error: null }),
      insert: (payload: unknown) => {
        captured.payload = payload;
        const inserted = {
          ...V1,
          id: "22222222-2222-4222-8222-222222222222",
          ...(payload as Record<string, unknown>),
        };
        const chain = {
          select: () => chain,
          single: () => Promise.resolve({ data: inserted, error: null }),
        };
        return chain;
      },
    };
    return builder;
  });
}

function renderTab(props?: {
  role?: "admin" | "professional" | "receptionist";
  entitled?: boolean | null;
  active?: boolean;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, children),
    );
  }
  return render(
    createElement(ProntuarioTab, {
      appointmentId: AP_ID,
      customerId: C_ID,
      role: props?.role ?? "admin",
      entitled: props?.entitled !== undefined ? props.entitled : true,
      active: props?.active ?? true,
      timeZone: "America/Sao_Paulo",
    }),
    { wrapper: Wrapper },
  );
}

afterEach(cleanup);

beforeEach(() => {
  fromMock.mockReset();
  storageFromMock.mockReset();
  storageFromMock.mockReturnValue({
    list: () => Promise.resolve({ data: [], error: null }),
    createSignedUrl: () =>
      Promise.resolve({ data: { signedUrl: "https://cdn.test/x" }, error: null }),
    upload: () => Promise.resolve({ data: { path: "x" }, error: null }),
    download: () => Promise.resolve({ data: null, error: { message: "not found" } }),
    remove: vi.fn(),
  });
});

describe("ProntuarioTab — banner de alergias", () => {
  it("mostra o banner destrutivo com aria-live quando há alergia", async () => {
    mockList([V1]);
    renderTab();
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("Penicilina");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
    expect(banner.className).toMatch(/sticky/);
  });

  it("mostra estado vazio sem destaque quando não há alergia", async () => {
    mockList([{ ...V1, allergies: null }]);
    renderTab();
    expect(
      await screen.findByText("Sem alergias registradas para este atendimento."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ProntuarioTab — ficha vigente", () => {
  it("exibe 3 grupos em leitura com rótulos e contadores", async () => {
    mockList([V1]);
    renderTab();
    expect(await screen.findByText("Ficha atual")).toBeTruthy();
    expect(
        (screen.getByLabelText("Alergias (somente leitura)") as HTMLTextAreaElement)
          .readOnly,
      ).toBe(true);
    expect(screen.getByText("10/500")).toBeTruthy();
    expect(screen.getByText("9/500")).toBeTruthy();
    expect(screen.getByText("18/2000")).toBeTruthy();
  });

  it("corrigir cria v2 via insert com supersedes_id, v1 intacta", async () => {
    const captured: { payload: unknown } = { payload: null };
    mockInsertCapture(captured);
    renderTab();
    fireEvent.click(await screen.findByText("Corrigir (nova versão)"));
    const notes = screen.getByLabelText("Observações do atendimento");
    fireEvent.change(notes, { target: { value: "Primeira consulta. Retorno em 30 dias." } });
    fireEvent.click(screen.getByText("Salvar nova versão"));
    await waitFor(() => {
      expect(captured.payload).toMatchObject({
        appointment_id: AP_ID,
        customer_id: C_ID,
        supersedes_id: V1.id,
      });
    });
    expect(captured.payload).not.toHaveProperty("tenant_id");
  });
});

describe("ProntuarioTab — evolução append-only", () => {
  it("timeline com badges v1/v2 e link ver original; nunca update/delete", async () => {
    const v2 = {
      ...V1,
      id: "22222222-2222-4222-8222-222222222222",
      supersedes_id: V1.id,
      clinical_notes: "Retorno.",
      created_at: "2026-11-11T12:00:00.000Z",
    };
    mockList([v2, V1]);
    const captured: { payload: unknown } = { payload: null };
    fromMock.mockImplementation(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: [V1, v2], error: null }),
        insert: (payload: unknown) => {
          captured.payload = payload;
          const chain = {
            select: () => chain,
            single: () =>
              Promise.resolve({
                data: { ...v2, ...(payload as Record<string, unknown>) },
                error: null,
              }),
          };
          return chain;
        },
      };
      return builder;
    });
    renderTab();
    expect(await screen.findByText("v1")).toBeTruthy();
    expect(await screen.findByText("v2")).toBeTruthy();
    expect(
        (screen.getByText("Ver original (v1)") as HTMLAnchorElement).getAttribute(
          "href",
        ),
      ).toBe(`#registro-${V1.id}`);
    fireEvent.click(screen.getByText("Nova evolução"));
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "Penicilina, dipirona" },
    });
    fireEvent.click(screen.getByText("Salvar evolução"));
    await waitFor(() => {
      expect(captured.payload).toMatchObject({ supersedes_id: v2.id });
    });
    const table = fromMock.mock.calls[0]?.[0];
    expect(table).toBe("clinical_records");
    expect(fromMock.mock.results.length).toBeGreaterThan(0);
  });

  it("caminho de escrita usa só select/eq/order/insert/single (nunca update/delete)", async () => {
    const accessed: string[] = [];
    mockList([V1]);
    fromMock.mockImplementation(() => {
      const terminal = (value: unknown) => Promise.resolve(value);
      const builder: Record<string, unknown> = {};
      const chainable = (..._args: unknown[]) => {
        accessed.push("chain");
        return proxy;
      };
      const proxy = new Proxy(builder, {
        get: (_target, prop) => {
          accessed.push(String(prop));
          if (prop === "order")
            return () => terminal({ data: [V1], error: null });
          if (prop === "single")
            return () => terminal({ data: V1, error: null });
          if (prop === "then") return undefined;
          return chainable;
        },
      });
      return proxy;
    });
    renderTab();
    fireEvent.click(await screen.findByText("Corrigir (nova versão)"));
    fireEvent.change(screen.getByLabelText("Observações do atendimento"), {
      target: { value: "Ajuste de conduta." },
    });
    fireEvent.click(screen.getByText("Salvar nova versão"));
    await waitFor(() => {
      expect(accessed).toContain("insert");
    });
    expect(accessed).not.toContain("update");
    expect(accessed).not.toContain("delete");
  });
});

describe("ProntuarioTab — RBAC por papel", () => {
  it("recepção vê só o banner, sem ficha nem evolução", async () => {
    mockList([V1]);
    renderTab({ role: "receptionist" });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Ficha atual")).toBeNull();
    expect(screen.queryByText("Evolução")).toBeNull();
    expect(
      screen.getByText("Ficha e evolução são restritas ao perfil clínico."),
    ).toBeTruthy();
  });

  it("professional vê tudo", async () => {
    mockList([V1]);
    renderTab({ role: "professional" });
    expect(await screen.findByText("Ficha atual")).toBeTruthy();
    expect(await screen.findByText("Evolução")).toBeTruthy();
  });
});

describe("ProntuarioTab — gating sem entitlement", () => {
  it("sem entitlement: upsell, sem request sensível", async () => {
    mockList([V1]);
    renderTab({ entitled: null });
    expect(await screen.findByText("Ver planos")).toBeTruthy();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("sem entitlement (false): banner indisponível, nunca vazio afirmativo", async () => {
    mockList([V1]);
    renderTab({ entitled: false });
    expect(await screen.findByText("Ver planos")).toBeTruthy();
    expect(
      screen.getByText("Dados de alergia indisponíveis sem o recurso Prontuário."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Sem alergias registradas para este atendimento."),
    ).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("sem entitlement (null): banner indisponível, nunca vazio afirmativo", async () => {
    mockList([V1]);
    renderTab({ entitled: null });
    expect(
      await screen.findByText("Dados de alergia indisponíveis sem o recurso Prontuário."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Sem alergias registradas para este atendimento."),
    ).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("aba fechada: sem request sensível", () => {
    mockList([V1]);
    renderTab({ active: false });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("ProntuarioTab — validação", () => {  it("form vazio é recusado com aria-invalid e foco no 1º inválido", async () => {
    mockList([]);
    renderTab();
    fireEvent.click(await screen.findByText("Nova evolução"));
    const allergies = screen.getByLabelText("Alergias");
    fireEvent.click(screen.getByText("Salvar evolução"));
    expect(
      await screen.findByText("Preencha ao menos um campo do registro."),
    ).toBeTruthy();
    expect(allergies.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(allergies);
  });

  it("limite excedido é recusado", async () => {
    mockList([]);
    renderTab();
    fireEvent.click(await screen.findByText("Nova evolução"));
    const allergies = screen.getByLabelText("Alergias");
    fireEvent.change(allergies, { target: { value: "a".repeat(501) } });
    fireEvent.blur(allergies);
    expect(
      await screen.findByText("Alergias: máximo de 500 caracteres."),
    ).toBeTruthy();
  });
});

describe("ProntuarioTab — ADR-05 fotos/mapa/termo", () => {
  it("perfil clínico vê as três seções na ordem T1 (fotos → mapa → termo)", async () => {
    mockList([V1]);
    renderTab({ role: "professional" });
    await screen.findByText("Ficha atual");
    const secoes = screen.getAllByRole("heading", { level: 4 });
    expect(secoes.map((secao) => secao.textContent)).toEqual([
      "Ficha atual",
      "Evolução",
      "Fotos antes e depois",
      "Mapa facial",
      "Termo de consentimento",
    ]);
  });

  it("recepção não vê fotos, mapa nem termo", async () => {
    mockList([V1]);
    renderTab({ role: "receptionist" });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Fotos antes e depois")).toBeNull();
    expect(screen.queryByText("Mapa facial")).toBeNull();
    expect(screen.queryByText("Termo de consentimento")).toBeNull();
  });
});
