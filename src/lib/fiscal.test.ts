import { describe, expect, it } from "vitest";

import {
  buildDanfeQrPayload,
  FISCAL_EVENT_TYPES,
  FISCAL_ORIGIN_TYPES,
  FISCAL_STATUSES,
  FISCAL_STATUS_META,
  fiscalMotivoLegivel,
  fiscalStatusVariant,
  formatChaveAcesso,
  isFiscalEventType,
  isFiscalOriginType,
  isFiscalStatus,
} from "@/lib/fiscal";

// ADR-02: documento fiscal tem 1 linha por origem (appointment|sale) e trilha
// append-only de eventos. Estes guards espelham os checks do banco — o teste fixa
// o contrato aqui para divergência entre lib e DDL falhar no unitário.

describe("fiscal — contratos de origem, status e evento (ADR-02)", () => {
  it("origens válidas são appointment e sale", () => {
    expect([...FISCAL_ORIGIN_TYPES]).toEqual(["appointment", "sale"]);
    expect(isFiscalOriginType("appointment")).toBe(true);
    expect(isFiscalOriginType("sale")).toBe(true);
    expect(isFiscalOriginType("subscription")).toBe(false);
    expect(isFiscalOriginType(null)).toBe(false);
  });

  it("status cobre o ciclo pendente → autorizada/contingência/rejeitada → cancelada", () => {
    expect([...FISCAL_STATUSES]).toEqual([
      "pendente",
      "autorizada",
      "contingencia",
      "rejeitada",
      "cancelada",
    ]);
    expect(isFiscalStatus("autorizada")).toBe(true);
    expect(isFiscalStatus("emitida")).toBe(false);
    expect(isFiscalStatus(undefined)).toBe(false);
  });

  it("eventos cobrem emissão, contingência, rejeição, cancelamento e carta", () => {
    expect([...FISCAL_EVENT_TYPES]).toEqual([
      "emissao",
      "contingencia",
      "rejeicao",
      "cancelamento",
      "carta",
    ]);
    expect(isFiscalEventType("cancelamento")).toBe(true);
    expect(isFiscalEventType("reemissao")).toBe(false);
    expect(isFiscalEventType("")).toBe(false);
  });
});

// ADR-03: apresentação da NFCe (RF-01/RF-03/RF-05). Puro, sem request.

const CHAVE = "1".repeat(44);

describe("fiscal — apresentação ADR-03", () => {
  it("status tem rótulo pt-BR e só autorizada tem valor fiscal/cancela", () => {
    expect(FISCAL_STATUS_META.autorizada).toEqual({
      rotulo: "Autorizada",
      temValorFiscal: true,
      permiteCancelar: true,
    });
    expect(FISCAL_STATUS_META.contingencia.temValorFiscal).toBe(false);
    expect(FISCAL_STATUS_META.cancelada.permiteCancelar).toBe(false);
  });

  it("badge varia por estado (rejeitada/cancelada destrutivo)", () => {
    expect(fiscalStatusVariant("autorizada")).toBe("default");
    expect(fiscalStatusVariant("rejeitada")).toBe("destructive");
    expect(fiscalStatusVariant("cancelada")).toBe("destructive");
    expect(fiscalStatusVariant("contingencia")).toBe("secondary");
    expect(fiscalStatusVariant("pendente")).toBe("outline");
  });

  it("chave formata em blocos e QR só existe com 44 dígitos", () => {
    expect(formatChaveAcesso(CHAVE)).toBe(Array(11).fill("1111").join(" "));
    expect(formatChaveAcesso(null)).toBe("—");
    expect(buildDanfeQrPayload(CHAVE)).toContain(CHAVE);
    expect(buildDanfeQrPayload(null)).toBeNull();
    expect(buildDanfeQrPayload("123")).toBeNull();
  });

  it("contingência sem motivo usa texto legível sem valor fiscal", () => {
    expect(fiscalMotivoLegivel("contingencia", null)).toContain("sem valor fiscal");
    expect(fiscalMotivoLegivel("rejeitada", null)).toContain("reemitir");
    expect(fiscalMotivoLegivel("autorizada", "SEFAZ ok")).toBe("SEFAZ ok");
  });
});
