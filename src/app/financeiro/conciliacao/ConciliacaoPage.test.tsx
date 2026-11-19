// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConciliacaoPage } from "@/app/financeiro/conciliacao/ConciliacaoPage";

const { entitlementsMock, fromMock, rpcMock, invokeMock, toastMock } = vi.hoisted(() => ({
  entitlementsMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock(),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
  },
}));

const CONTA = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "t1",
  nome: "Conta principal",
  banco: "Banco Teste",
  conta_ultimos4: "4321",
  saldo_inicial_cents: 100_000,
  ativo: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

const EXTRATO = {
  id: "22222222-2222-4222-8222-222222222222",
  tenant_id: "t1",
  account_id: CONTA.id,
  formato: "ofx",
  nome_arquivo: "extrato-janeiro.ofx",
  periodo_ini: "2026-01-05",
  periodo_fim: "2026-01-12",
  saldo_ini_cents: 100_000,
  saldo_fim_cents: 99_466,
  linhas_total: 2,
  created_at: "2026-01-13T00:00:00.000Z",
};

function linha(over: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    tenant_id: "t1",
    statement_id: EXTRATO.id,
    data: "2026-01-05",
    descricao: "Pagamento fornecedor",
    valor_cents: -15_000,
    status: "pendente",
    motivo_ignorado: null,
    created_at: "2026-01-13T00:00:00.000Z",
    ...over,
  };
}

const LINHA_A = linha();
const LINHA_B = linha({
  id: "44444444-4444-4444-8444-444444444444",
  data: "2026-01-10",
  descricao: "Recebimento PIX",
  valor_cents: 123_456,
});

function chain(data: unknown) {
  const builder = {} as Record<string, (...args: never[]) => unknown>;
  for (const metodo of ["select", "order", "limit", "eq", "in"] as const) {
    builder[metodo] = () => builder;
  }
  builder["then"] = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

interface RpcOptions {
  candidatos?: unknown[];
  link?: { linked: number; link_ids: string[] };
}

function mockDados(opcoes: RpcOptions = {}) {
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "bank_accounts") return chain([CONTA]);
    if (tabela === "bank_statements") return chain([EXTRATO]);
    if (tabela === "bank_lines") return chain([LINHA_A, LINHA_B]);
    if (tabela === "reconciliation_links") return chain([]);
    if (tabela === "suppliers") return chain([]);
    if (tabela === "customers") return chain([]);
    return chain([]);
  });

  rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === "reconciliation_suggest_matches") {
      const candidatos =
        opcoes.candidatos ??
        (args.p_bank_line_id === LINHA_A.id
          ? [
              {
                alvo_tipo: "payable",
                alvo_id: "55555555-5555-4555-8555-555555555555",
                descricao: "Aluguel do salão",
                valor_cents: 15_000,
                data: "2026-01-05",
                delta_dias: 0,
                score: 100,
              },
            ]
          : [
              {
                alvo_tipo: "receivable",
                alvo_id: "66666666-6666-4666-8666-666666666666",
                descricao: "Avulsa PIX",
                valor_cents: 123_456,
                data: "2026-01-10",
                delta_dias: 0,
                score: 100,
              },
            ]);
      return Promise.resolve({
        data: {
          bank_line_id: args.p_bank_line_id,
          valor_cents: -15_000,
          data: "2026-01-05",
          tolerancia_dias: 2,
          candidatos,
        },
        error: null,
      });
    }
    if (fn === "reconciliation_link") {
      return Promise.resolve({
        data: opcoes.link ?? { linked: 1, link_ids: ["77777777-7777-4777-8777-777777777777"] },
        error: null,
      });
    }
    if (fn === "reconciliation_ignore") {
      return Promise.resolve({ data: { ignored: 1 }, error: null });
    }
    if (fn === "reconciliation_create_entry") {
      return Promise.resolve({
        data: {
          bank_line_id: args.p_bank_line_id,
          link_id: "88888888-8888-4888-8888-888888888888",
          alvo_tipo: "payable",
          alvo_id: "99999999-9999-4999-8999-999999999999",
          status: "conciliado",
        },
        error: null,
      });
    }
    if (fn === "reconciliation_undo") {
      return Promise.resolve({
        data: { bank_line_id: LINHA_A.id, undone: true, dentro_da_janela: true },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  invokeMock.mockResolvedValue({
    data: {
      statement_id: EXTRATO.id,
      linhas_total: 2,
      periodo_ini: "2026-01-05",
      periodo_fim: "2026-01-12",
      saldo_ini_cents: null,
      saldo_fim_cents: 99_466,
      replayed: false,
    },
    error: null,
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConciliacaoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConciliacaoPage — ADR-08 (gating, split/tabs, ações)", () => {
  beforeEach(() => {
    entitlementsMock.mockReturnValue({ conciliacao: true });
    mockDados();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gating conciliacao=false → upsell legível e zero request", async () => {
    entitlementsMock.mockReturnValue({ conciliacao: false });
    renderPage();

    expect(screen.getByText("Conciliação disponível no plano")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver planos" })).toBeTruthy();
    // Escrita sem entitlement não fica exposta: "Nova conta" some do upsell.
    expect(screen.queryByRole("button", { name: "Nova conta" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Importar extrato" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gating conciliacao=null → upsell sem travar e zero request", async () => {
    entitlementsMock.mockReturnValue(null);
    renderPage();
    expect(screen.getByText("Conciliação disponível no plano")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nova conta" })).toBeNull();
    await waitFor(() => expect(fromMock).not.toHaveBeenCalled());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("split no desktop e alternância Extrato/Lançamentos no mobile", async () => {
    renderPage();

    await screen.findByText("Pagamento fornecedor");
    expect(screen.getByRole("region", { name: "Extrato bancário" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Lançamentos do match" })).toBeTruthy();

    const alternar = screen.getByRole("button", { name: "Lançamentos" });
    expect(alternar.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(alternar);
    expect(alternar.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Extrato" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    // Saldos do extrato em cards, com entradas e saídas assinadas.
    const extratoRegion = screen.getByRole("region", { name: "Extrato bancário" });
    expect(screen.getByText("R$ 1.000,00")).toBeTruthy();
    expect(screen.getByText("R$ 994,66")).toBeTruthy();
    expect(within(extratoRegion).getByText("+R$ 1.234,56")).toBeTruthy();
    expect(within(extratoRegion).getByText("−R$ 150,00")).toBeTruthy();
  });

  it("split usa min-w-0 para o scroll da tabela ficar no invólucro, não na página", async () => {
    renderPage();
    await screen.findByText("Pagamento fornecedor");

    const extrato = screen.getByRole("region", { name: "Extrato bancário" });
    const lancamentos = screen.getByRole("region", { name: "Lançamentos do match" });

    // Item de grid/flex com `min-width: auto` deixa o min-content da tabela
    // escapar para a página (scrollWidth > clientWidth em 375px). `min-w-0`
    // nos dois painéis mantém o overflow dentro do invólucro com scroll.
    expect(extrato.className).toContain("min-w-0");
    expect(lancamentos.className).toContain("min-w-0");
    // A página não recebe o overflow: o invólucro da tabela é quem rola.
    expect(extrato.className).not.toContain("overflow-x-auto");

    const tabela = within(extrato).getByRole("table");
    const involucro = tabela.parentElement;
    expect(involucro?.className).toContain("overflow-auto");
    expect(involucro?.parentElement?.className).toContain("overflow-x-auto");
  });

  it("selecionar linha pede o match e conciliar chama a RPC com o par sugerido", async () => {
    renderPage();
    await screen.findByText("Pagamento fornecedor");

    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar Pagamento fornecedor/ }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("reconciliation_suggest_matches", {
        p_bank_line_id: LINHA_A.id,
      }),
    );
    const candidato = await screen.findByText("Aluguel do salão");
    expect(candidato).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Conciliar com Aluguel do salão/ }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("reconciliation_link", {
        p_links: [
          {
            bank_line_id: LINHA_A.id,
            alvo_tipo: "payable",
            alvo_id: "55555555-5555-4555-8555-555555555555",
          },
        ],
      }),
    );
    expect(toastMock.success).toHaveBeenCalled();
    const [, opcoes] = toastMock.success.mock.calls[0] as [string, { action: { label: string } }];
    expect(opcoes.action.label).toBe("Desfazer");
  });

  it("conciliar em lote concilia as linhas selecionadas em UMA chamada", async () => {
    renderPage();
    await screen.findByText("Pagamento fornecedor");

    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar Pagamento fornecedor/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar Recebimento PIX/ }));

    fireEvent.click(screen.getByRole("button", { name: "Conciliar em lote" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("reconciliation_link", {
        p_links: [
          {
            bank_line_id: LINHA_A.id,
            alvo_tipo: "payable",
            alvo_id: "55555555-5555-4555-8555-555555555555",
          },
          {
            bank_line_id: LINHA_B.id,
            alvo_tipo: "receivable",
            alvo_id: "66666666-6666-4666-8666-666666666666",
          },
        ],
      }),
    );
  });

  it("ignorar exige motivo antes de chamar a RPC", async () => {
    renderPage();
    await screen.findByText("Pagamento fornecedor");

    fireEvent.click(screen.getByRole("button", { name: /Ignorar Pagamento fornecedor/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Linhas ignoradas saem da conciliação/)).toBeTruthy();

    fireEvent.change(within(dialogo).getByLabelText("Motivo"), { target: { value: "x" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Ignorar com motivo" }));
    expect(await within(dialogo).findByText(/mínimo 3 caracteres/)).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalledWith("reconciliation_ignore", expect.anything());

    fireEvent.change(within(dialogo).getByLabelText("Motivo"), {
      target: { value: "Tarifa já lançada" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Ignorar com motivo" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("reconciliation_ignore", {
        p_bank_line_ids: [LINHA_A.id],
        p_motivo: "Tarifa já lançada",
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith("1 linha ignorada.");
  });

  it("sem candidato, oferece criar lançamento a partir da órfã", async () => {
    mockDados({ candidatos: [] });
    renderPage();
    await screen.findByText("Pagamento fornecedor");

    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar Pagamento fornecedor/ }));
    expect(await screen.findByText("Nenhum lançamento compatível")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Criar lançamento" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Criar conta a pagar/)).toBeTruthy();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar e conciliar" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("reconciliation_create_entry", {
        p_bank_line_id: LINHA_A.id,
        p_supplier_id: null,
        p_customer_id: null,
        p_categoria: null,
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith(
      "Conta a pagar criada e conciliada.",
      expect.anything(),
    );
  });
});
