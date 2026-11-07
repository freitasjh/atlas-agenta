import { describe, expect, it } from "vitest";

import {
  formatMessage,
  paymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";

/**
 * RNF-03: o catálogo é a única fonte de texto. Toda folha precisa ser string
 * não vazia; `formatMessage` substitui placeholders conhecidos e preserva os
 * desconhecidos (nunca `undefined`).
 */

function leaves(value: unknown, path: string[] = []): Array<[string[], string]> {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => leaves(child, [...path, key]),
    );
  }
  throw new Error(`Folha não textual em ${path.join(".")}`);
}

describe("paymentsMessages", () => {
  it("tem todos os grupos exigidos pelo ADR-004", () => {
    for (const group of [
      "gating",
      "method",
      "dialog",
      "fields",
      "actions",
      "status",
      "partial",
      "discard",
      "registerLater",
      "error",
      "receipt",
      "badge",
      "void",
      "settlement",
      "agenda",
      "pix",
      "chargesPage",
      "financialSummary",
      "receipts",
    ]) {
      expect(paymentsMessages).toHaveProperty(group);
    }
  });

  it("toda folha é string não vazia", () => {
    const all = leaves(paymentsMessages);
    expect(all.length).toBeGreaterThan(50);
    for (const [path, text] of all) {
      expect(text.trim().length, path.join(".")).toBeGreaterThan(0);
    }
  });

  it("mantém os textos congelados do ADR §6", () => {
    expect(paymentsMessages.dialog.title).toBe("Fechar atendimento");
    expect(paymentsMessages.dialog.subtitle).toBe(
      "Registre como o cliente pagou.",
    );
    expect(paymentsMessages.method.pix_sistema).toBe("PIX do sistema");
    expect(paymentsMessages.actions.registerLater).toBe("Registrar depois");
    expect(paymentsMessages.fields.tipHint).toBe(
      "A gorjeta não entra na receita do serviço nem na comissão.",
    );
    expect(paymentsMessages.partial.warning).toBe(
      "O atendimento ficará com saldo em aberto. Confirmar?",
    );
    expect(paymentsMessages.badge.pending).toBe("Pagamento pendente");
    expect(paymentsMessages.void.refundWarning).toBe(
      "O dinheiro não volta pelo sistema. A conciliação no Asaas é manual.",
    );
  });

  it("mantém os textos congelados do painel financeiro (ADR-005 §4)", () => {
    expect(paymentsMessages.financialSummary.groupReceived).toBe("Recebido");
    expect(paymentsMessages.financialSummary.groupReceivedBase).toBe(
      "Recebido no período (caixa)",
    );
    expect(paymentsMessages.financialSummary.groupPendingBase).toBe(
      "A receber agora · Em aberto no período",
    );
    expect(paymentsMessages.financialSummary.cashNote).toBe(
      "Comissão é por competência (concluído); este painel é caixa (recebido).",
    );
    expect(paymentsMessages.receipts.emptyTitle).toBe(
      "Nenhum recebimento no período.",
    );
    expect(paymentsMessages.receipts.situacao.estornados).toBe("Estornados");
  });
  it("não deixa placeholder conhecido sem valor", () => {
    expect(
      formatMessage(paymentsMessages.actions.addMethodNamed, {
        metodo: paymentsMessages.method.dinheiro,
      }),
    ).toBe("Adicionar Dinheiro");
  });

  it("preserva placeholder desconhecido literalmente", () => {
    expect(formatMessage("Total {valor}", { outro: "x" })).toBe("Total {valor}");
  });

  it("sem valores devolve o template intacto", () => {
    expect(formatMessage("{cliente} · {servico}")).toBe("{cliente} · {servico}");
  });

  it("interpola todos os placeholders do catálogo sem sobrar chave", () => {
    const templates = leaves(paymentsMessages).filter(([, text]) =>
      /\{\w+\}/.test(text),
    );
    for (const [, template] of templates) {
      const keys = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const values = Object.fromEntries(keys.map((key) => [key, `x-${key}`]));
      const rendered = formatMessage(template, values);
      expect(rendered).not.toMatch(/\{\w+\}/);
      expect(rendered).not.toContain("undefined");
    }
  });
});
