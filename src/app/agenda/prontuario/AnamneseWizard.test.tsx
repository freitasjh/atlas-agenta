// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnamneseWizard } from "@/app/agenda/prontuario/AnamneseWizard";
import { ProntuarioTab } from "@/app/agenda/prontuario/ProntuarioTab";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
      order: () => Promise.resolve({ data: [], error: null }),
      insert: (payload: unknown) => {
        captured.payload = payload;
        const chain = {
          select: () => chain,
          single: () =>
            Promise.resolve({
              data: {
                id: "22222222-2222-4222-8222-222222222222",
                tenant_id: "t-1",
                customer_id: C_ID,
                appointment_id: AP_ID,
                supersedes_id: null,
                allergies: null,
                medications: null,
                clinical_notes: null,
                created_by: "u-1",
                created_at: "2026-11-11T12:00:00.000Z",
                ...(payload as Record<string, unknown>),
              },
              error: null,
            }),
        };
        return chain;
      },
    };
    return builder;
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(MemoryRouter, null, children),
  );
}

function renderWizard() {
  return render(
    createElement(AnamneseWizard, {
      appointmentId: AP_ID,
      customerId: C_ID,
    }),
    { wrapper: Wrapper },
  );
}

function renderTab() {
  return render(
    createElement(ProntuarioTab, {
      appointmentId: AP_ID,
      customerId: C_ID,
      role: "admin",
      entitled: true,
      active: true,
      timeZone: "America/Sao_Paulo",
    }),
    { wrapper: Wrapper },
  );
}

function openWizard() {
  fireEvent.click(screen.getByRole("button", { name: /ficha/i }));
}

function progressItems() {
  const progress = screen.getByRole("list", {
    name: "Progresso da anamnese",
  });
  return within(progress).getAllByRole("listitem");
}

afterEach(cleanup);

beforeEach(() => {
  fromMock.mockReset();
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* happy-dom sem localStorage: draftStore cai para sessionStorage */
  }
  try {
    globalThis.sessionStorage?.clear();
  } catch {
    /* armazenamento indisponível: segue sem rascunho */
  }
});

describe("AnamneseWizard — banner CTA", () => {
  it("mostra 'Ficha não criada' + CTA sem disparar request sensível", () => {
    mockList([]);
    renderWizard();
    expect(screen.getByText("Ficha não criada")).toBeTruthy();
    expect(screen.getByText("Criar primeira ficha")).toBeTruthy();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("CTA abre o passo 1 com foco no heading", () => {
    mockList([]);
    renderWizard();
    openWizard();
    const heading = screen.getByRole("heading", { name: "Quem" });
    expect(heading.tagName).toBe("H2");
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
  });
});

describe("AnamneseWizard — 3 passos", () => {
  it("navega Quem → Histórico → Revisão com progresso aria-current", () => {
    mockList([]);
    renderWizard();
    openWizard();

    const items = progressItems();
    expect(items[0]?.getAttribute("aria-current")).toBe("step");
    expect(items[0]?.textContent).toContain("Quem");

    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "Penicilina" },
    });
    fireEvent.click(screen.getByText("Continuar"));
    expect(
      screen.getByRole("heading", { name: "Histórico e contraindicações" }),
    ).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("Histórico");
    expect(progressItems()[1]?.getAttribute("aria-current")).toBe("step");

    fireEvent.click(screen.getByText("Continuar"));
    expect(
      screen.getByRole("heading", { name: "Revisão e consentimento" }),
    ).toBeTruthy();
    expect(progressItems()[2]?.getAttribute("aria-current")).toBe("step");
  });

  it("passo inativo fica com hidden e fora da ordem de Tab", () => {
    mockList([]);
    renderWizard();
    openWizard();
    // `hidden` remove da ordem de Tab e das role queries (a11y tree).
    expect(
      screen.queryByRole("textbox", { name: "Medicamentos" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Observações do atendimento" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Alergias" }),
    ).toBeTruthy();
    expect(document.querySelectorAll("section div[hidden]").length).toBe(2);
  });

  it("Voltar retorna ao passo anterior sem validar", () => {
    mockList([]);
    renderWizard();
    openWizard();
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "Penicilina" },
    });
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Voltar"));
    expect(screen.getByRole("heading", { name: "Quem" })).toBeTruthy();
    expect(
      (screen.getByLabelText("Alergias") as HTMLTextAreaElement).value,
    ).toBe("Penicilina");
  });
});

describe("AnamneseWizard — validação", () => {
  it("blur valida campo editado com aria-invalid; digitar limpa", async () => {
    mockList([]);
    renderWizard();
    openWizard();
    const allergies = screen.getByLabelText("Alergias");
    fireEvent.change(allergies, { target: { value: "a".repeat(501) } });
    fireEvent.blur(allergies);
    expect(
      await screen.findByText("Alergias: máximo de 500 caracteres."),
    ).toBeTruthy();
    expect(allergies.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(allergies, { target: { value: "Penicilina" } });
    await waitFor(() => {
      expect(
        screen.queryByText("Alergias: máximo de 500 caracteres."),
      ).toBeNull();
    });
  });

  it("blur em campo virgem não mostra erro", () => {
    mockList([]);
    renderWizard();
    openWizard();
    const allergies = screen.getByLabelText("Alergias");
    fireEvent.blur(allergies);
    expect(
      screen.queryByText("Preencha ao menos um campo do registro."),
    ).toBeNull();
    expect(allergies.getAttribute("aria-invalid")).toBe("false");
  });

  it("submit final vazio foca o 1º inválido e não dispara insert", async () => {
    mockList([]);
    renderWizard();
    openWizard();
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "x" },
    });
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Salvar ficha"));
    const allergies = await screen.findByLabelText("Alergias");
    expect(
      await screen.findByText("Preencha ao menos um campo do registro."),
    ).toBeTruthy();
    expect(allergies.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(allergies);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("mínimo 1 campo: ficha válida insere via insert com supersedes_id nulo", async () => {
    const captured: { payload: unknown } = { payload: null };
    mockInsertCapture(captured);
    renderWizard();
    openWizard();
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "Penicilina" },
    });
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Continuar"));
    expect(screen.getByText("Penicilina")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Salvar ficha"));
    await waitFor(() => {
      expect(captured.payload).toMatchObject({
        appointment_id: AP_ID,
        customer_id: C_ID,
        allergies: "Penicilina",
        supersedes_id: null,
      });
    });
    expect(captured.payload).not.toHaveProperty("tenant_id");
  });

  it("sem consentimento: submit recusado com foco no checkbox", async () => {
    mockList([]);
    renderWizard();
    openWizard();
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "Penicilina" },
    });
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Salvar ficha"));
    expect(
      await screen.findByText("Confirme o consentimento para salvar a ficha."),
    ).toBeTruthy();
    expect(document.activeElement?.getAttribute("role")).toBe("checkbox");
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("AnamneseWizard — rascunho local", () => {
  it("recarregar mantém o rascunho", () => {
    mockList([]);
    const first = renderWizard();
    openWizard();
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "Penicilina" },
    });
    first.unmount();
    renderWizard();
    openWizard();
    expect(
      (screen.getByLabelText("Alergias") as HTMLTextAreaElement).value,
    ).toBe("Penicilina");
  });

  it("descarte exige confirmação em 2 cliques", async () => {
    mockList([]);
    renderWizard();
    openWizard();
    fireEvent.change(screen.getByLabelText("Alergias"), {
      target: { value: "Penicilina" },
    });
    const discard = screen.getByText("Descartar rascunho");
    fireEvent.click(discard);
    expect(screen.getByText("Confirmar descarte")).toBeTruthy();
    expect(
      (screen.getByLabelText("Alergias") as HTMLTextAreaElement).value,
    ).toBe("Penicilina");
    fireEvent.click(screen.getByText("Confirmar descarte"));
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Alergias") as HTMLTextAreaElement).value,
      ).toBe("");
    });
    expect(sessionStorage.getItem(`anamnese-rascunho:${AP_ID}`)).toBeNull();
  });
});

describe("AnamneseWizard — integração ProntuarioTab", () => {
  it("sem ficha: aba mostra banner + CTA que abre o wizard", async () => {
    mockList([]);
    renderTab();
    expect(await screen.findByText("Ficha não criada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ficha/i }));
    expect(screen.getByRole("heading", { name: "Quem" })).toBeTruthy();
  });

  it("com ficha: sem banner de wizard", async () => {
    mockList([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: "t-1",
        customer_id: C_ID,
        appointment_id: AP_ID,
        supersedes_id: null,
        allergies: "Penicilina",
        medications: null,
        clinical_notes: null,
        created_by: "u-1",
        created_at: "2026-11-10T12:00:00.000Z",
      },
    ]);
    renderTab();
    expect(await screen.findByText("Ficha atual")).toBeTruthy();
    expect(screen.queryByText("Ficha não criada")).toBeNull();
  });
});
