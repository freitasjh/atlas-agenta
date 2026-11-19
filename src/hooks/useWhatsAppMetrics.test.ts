// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aggregateWhatsAppKpis,
  assessBanRisk,
  EMPTY_LOG_FILTER,
  filterMessageLog,
} from "@/hooks/useWhatsAppMetrics";
import type { Message } from "@/types/domain";

afterEach(cleanup);

function message(
  overrides: Partial<Message> & { id: string },
): Message {
  return {
    tenant_id: "tenant-1",
    customer_id: "cliente-1",
    appointment_id: null,
    channel: "whatsapp",
    template: "confirmacao",
    status: "enviado",
    provider_message_id: null,
    failure_reason: null,
    payload: {},
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  } as Message;
}

const useMessagesMocks = vi.hoisted(() => ({
  data: [] as Message[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useMessages", () => ({
  useRecentMessages: () => ({
    data: useMessagesMocks.data,
    isLoading: useMessagesMocks.isLoading,
    isError: useMessagesMocks.isError,
    refetch: useMessagesMocks.refetch,
  }),
}));

describe("aggregateWhatsAppKpis (ADR-11/ADR-18)", () => {
  it("whenEmpty_thenZeroWithNullRates", () => {
    const kpis = aggregateWhatsAppKpis([]);
    expect(kpis.total).toBe(0);
    expect(kpis.taxaEntrega).toBeNull();
    expect(kpis.taxaFalha).toBeNull();
    expect(kpis.parcial).toBe(true);
  });

  it("whenMixedStatuses_thenCountsCorrectly", () => {
    const kpis = aggregateWhatsAppKpis([
      message({ id: "1", status: "enviado" }),
      message({ id: "2", status: "entregue" }),
      message({ id: "3", status: "entregue" }),
      message({ id: "4", status: "falha", failure_reason: "bloqueado" }),
      message({ id: "5", status: "fila" }),
      message({ id: "6", status: "enviando" }),
    ]);
    expect(kpis.total).toBe(6);
    expect(kpis.enviadas).toBe(3);
    expect(kpis.entregues).toBe(2);
    expect(kpis.falhas).toBe(1);
    expect(kpis.pendentes).toBe(2);
    expect(kpis.taxaEntrega).toBeCloseTo(2 / 3);
    expect(kpis.taxaFalha).toBeCloseTo(1 / 4);
  });
});

describe("assessBanRisk", () => {
  it("whenNoVolume_thenBaixoSemVeredito", () => {
    const risk = assessBanRisk(aggregateWhatsAppKpis([]));
    expect(risk.level).toBe("baixo");
    expect(risk.taxaFalha).toBeNull();
  });

  it("whenFailureAbove10_thenAlto", () => {
    const risk = assessBanRisk(
      aggregateWhatsAppKpis([
        message({ id: "1", status: "enviado" }),
        message({ id: "2", status: "falha" }),
      ]),
    );
    expect(risk.level).toBe("alto");
    expect(risk.recomendacao).toContain("10%");
  });

  it("whenFailureBetween5And10_thenAtencao", () => {
    const messages: Message[] = Array.from({ length: 12 }, (_, i) =>
      message({ id: `ok-${i}`, status: "enviado" }),
    );
    messages.push(message({ id: "fail-1", status: "falha" }));
    expect(assessBanRisk(aggregateWhatsAppKpis(messages)).level).toBe(
      "atencao",
    );
  });

  it("whenHealthy_thenBaixo", () => {
    const messages: Message[] = Array.from({ length: 50 }, (_, i) =>
      message({ id: `ok-${i}`, status: "entregue" }),
    );
    const risk = assessBanRisk(aggregateWhatsAppKpis(messages));
    expect(risk.level).toBe("baixo");
  });
});

describe("filterMessageLog", () => {
  const log = [
    message({ id: "1", status: "entregue", template: "confirmacao" }),
    message({
      id: "2",
      status: "falha",
      template: "lembrete_d1",
      failure_reason: "Número bloqueado",
    }),
    message({ id: "3", status: "fila", template: "cobranca" }),
  ];

  it("whenEmptyFilter_thenReturnsAll", () => {
    expect(filterMessageLog(log, EMPTY_LOG_FILTER)).toHaveLength(3);
  });

  it("whenStatusSelected_thenFilters", () => {
    expect(
      filterMessageLog(log, { ...EMPTY_LOG_FILTER, status: "falha" }),
    ).toHaveLength(1);
  });

  it("whenTemplateSelected_thenFilters", () => {
    expect(
      filterMessageLog(log, { ...EMPTY_LOG_FILTER, template: "cobranca" }),
    ).toHaveLength(1);
  });

  it("whenSearchMatchesFailureReason_thenFilters", () => {
    expect(
      filterMessageLog(log, { ...EMPTY_LOG_FILTER, busca: "bloqueado" }),
    ).toHaveLength(1);
  });

  it("whenSearchMatchesCustomerName_thenFilters", () => {
    const names = new Map([["cliente-1", "Maria Silva"]]);
    const withOther = [
      ...log,
      message({ id: "4", status: "enviado", customer_id: "cliente-9" }),
    ];
    const namesFn = (id: string) =>
      id === "cliente-1" ? "Maria Silva" : (names.get(id) ?? "Cliente");
    const result = filterMessageLog(
      withOther,
      { ...EMPTY_LOG_FILTER, busca: "maria" },
      namesFn,
    );
    expect(result).toHaveLength(3);
  });

  it("whenSearchMatchesNothing_thenEmpty", () => {
    expect(
      filterMessageLog(log, { ...EMPTY_LOG_FILTER, busca: "zzz" }),
    ).toHaveLength(0);
  });
});
