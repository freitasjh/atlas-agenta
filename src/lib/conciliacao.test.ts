import { describe, expect, it } from "vitest";

import {
  CONCILIACAO_STATUS_META,
  UNDO_WINDOW_MS,
  chaveAlvo,
  conciliacaoErrorMessage,
  formatarDataExtrato,
  isConciliacaoStatus,
  melhorCandidato,
  melhorCandidatoLivre,
  parseBankLines,
  undoDentroDaJanela,
  valorAssinado,
  type MatchCandidate,
} from "@/lib/conciliacao";

function candidato(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    alvo_tipo: "payable",
    alvo_id: "p1",
    descricao: "Aluguel",
    valor_cents: 150_000,
    data: "2026-12-10",
    delta_dias: 0,
    score: 100,
    ...over,
  };
}

describe("lib/conciliacao — valor assinado e datas", () => {
  it("crédito/débito aparecem com sinal e centavos pt-BR", () => {
    expect(valorAssinado(123_456)).toBe("+R$ 1.234,56");
    expect(valorAssinado(-15_000)).toBe("−R$ 150,00");
    expect(valorAssinado(-5)).toBe("−R$ 0,05");
    expect(valorAssinado(0)).toBe("+R$ 0,00");
  });

  it("data do extrato é exibida dd/mm/aaaa sem deslocar o dia", () => {
    expect(formatarDataExtrato("2026-01-05")).toBe("05/01/2026");
    expect(formatarDataExtrato("2026-12-31")).toBe("31/12/2026");
    expect(formatarDataExtrato("inválida")).toBe("—");
  });
});

describe("lib/conciliacao — janela de undo (5s)", () => {
  const criado = "2026-02-10T12:00:00.000Z";

  it("aceita até 5s, recusa depois", () => {
    const agora = new Date("2026-02-10T12:00:00.000Z");
    expect(undoDentroDaJanela(criado, agora)).toBe(true);

    const quartoSegundo = new Date(agora.getTime() + UNDO_WINDOW_MS);
    expect(undoDentroDaJanela(criado, quartoSegundo)).toBe(true);

    const depois = new Date(agora.getTime() + UNDO_WINDOW_MS + 1);
    expect(undoDentroDaJanela(criado, depois)).toBe(false);
  });

  it("data inválida nunca abre a janela", () => {
    expect(undoDentroDaJanela("ontem")).toBe(false);
  });
});

describe("lib/conciliacao — match", () => {
  it("melhor candidato é o de maior score (menor distância de data)", () => {
    const longe = candidato({ alvo_id: "longe", delta_dias: 2, score: 80 });
    const exato = candidato({ alvo_id: "exato", delta_dias: 0, score: 100 });
    expect(melhorCandidato([longe, exato])?.alvo_id).toBe("exato");
    expect(melhorCandidato([])).toBeNull();
  });

  it("lote escolhe o próximo alvo livre e nunca repete o mesmo lançamento", () => {
    const primeiro = candidato({ alvo_id: "p1", delta_dias: 0, score: 100 });
    const segundo = candidato({ alvo_id: "p2", delta_dias: 1, score: 90 });
    const usados = new Set([chaveAlvo(primeiro)]);

    expect(melhorCandidatoLivre([primeiro, segundo], usados)?.alvo_id).toBe("p2");
    expect(melhorCandidatoLivre([primeiro], usados)).toBeNull();
    expect(chaveAlvo(primeiro)).toBe("payable:p1");
  });

  it("status desconhecido não vira linha do extrato", () => {
    const bruto = [
      {
        id: "l1",
        tenant_id: "t1",
        statement_id: "s1",
        data: "2026-01-05",
        descricao: "OK",
        valor_cents: -100,
        status: "pendente",
        motivo_ignorado: null,
        created_at: "2026-01-05T00:00:00.000Z",
      },
      {
        id: "l2",
        tenant_id: "t1",
        statement_id: "s1",
        data: "2026-01-05",
        descricao: "Estado inválido",
        valor_cents: -100,
        status: "sumiu",
        motivo_ignorado: null,
        created_at: "2026-01-05T00:00:00.000Z",
      },
    ];
    const linhas = parseBankLines(bruto);
    expect(linhas.map((linha) => linha.id)).toEqual(["l1"]);
    expect(linhas[0]?.status).toBe("pendente");
  });

  it("meta dos estados cobre os três valores do banco", () => {
    expect(isConciliacaoStatus("pendente")).toBe(true);
    expect(isConciliacaoStatus("conciliado")).toBe(true);
    expect(isConciliacaoStatus("ignorado")).toBe(true);
    expect(isConciliacaoStatus("outro")).toBe(false);
    expect(Object.keys(CONCILIACAO_STATUS_META).sort()).toEqual([
      "conciliado",
      "ignorado",
      "pendente",
    ]);
  });
});

describe("lib/conciliacao — erros legíveis", () => {
  it("código estável vira pt-BR; mensagem humana passa direto", () => {
    expect(conciliacaoErrorMessage("RECONCILIATION_VALUE_MISMATCH", "fallback")).toContain(
      "valor exato",
    );
    expect(conciliacaoErrorMessage("STATEMENT_INVALID_DATE", "fallback")).toBe(
      "O arquivo tem uma data inválida.",
    );
    expect(conciliacaoErrorMessage("UNDO_REASON_REQUIRED", "fallback")).toContain("motivo");
    expect(conciliacaoErrorMessage("Já conciliada antes.", "fallback")).toBe(
      "Já conciliada antes.",
    );
    expect(conciliacaoErrorMessage("CODIGO_DESCONHECIDO", "fallback")).toBe("fallback");
    expect(conciliacaoErrorMessage(null, "fallback")).toBe("fallback");
    expect(conciliacaoErrorMessage("   ", "fallback")).toBe("fallback");
  });
});
