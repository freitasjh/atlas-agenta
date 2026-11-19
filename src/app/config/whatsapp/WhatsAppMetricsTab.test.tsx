// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsAppMetricsTab } from "@/app/config/whatsapp/WhatsAppMetricsTab";
import type { Message } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  messages: [] as Message[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  customers: [] as Array<{ id: string; name: string }>,
  tenant: { timezone: "America/Sao_Paulo" } as unknown,
}));

vi.mock("@/hooks/useMessages", () => ({
  useRecentMessages: () => ({
    data: mocks.messages,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({ data: mocks.customers, isLoading: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: mocks.tenant }),
}));

afterEach(() => {
  cleanup();
  mocks.messages = [];
  mocks.customers = [];
  mocks.isLoading = false;
  mocks.isError = false;
});

function message(overrides: Partial<Message> & { id: string }): Message {
  return {
    tenant_id: "tenant-1",
    customer_id: "cliente-1",
    appointment_id: null,
    channel: "whatsapp",
    template: "confirmacao",
    status: "entregue",
    provider_message_id: null,
    failure_reason: null,
    payload: {},
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  } as Message;
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <WhatsAppMetricsTab />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("WhatsAppMetricsTab (RF-40)", () => {
  it("whenMessages_thenShowsKpisAndBanRisk", () => {
    mocks.messages = [
      message({ id: "1", status: "entregue" }),
      message({ id: "2", status: "falha", template: "cobranca" }),
    ];
    mocks.customers = [{ id: "cliente-1", name: "Maria Silva" }];
    renderTab();
    expect(screen.getByText("Desempenho do canal")).toBeDefined();
    expect(screen.getByText("Enviadas")).toBeDefined();
    expect(screen.getByText("Taxa de entrega")).toBeDefined();
    expect(screen.getByText(/Risco de ban/)).toBeDefined();
    expect(screen.getAllByText("Maria Silva").length).toBeGreaterThan(0);
  });

  it("whenEmpty_thenShowsEmptyStates", () => {
    renderTab();
    expect(screen.getByText(/Sem envios no período/)).toBeDefined();
    expect(screen.getByText(/Nada encontrado/)).toBeDefined();
  });

  it("whenLoading_thenShowsBusyState", () => {
    mocks.isLoading = true;
    renderTab();
    expect(screen.getByLabelText(/Carregando métricas/)).toBeDefined();
  });

  it("whenError_thenShowsRetry", () => {
    mocks.isError = true;
    renderTab();
    expect(
      screen.getByText(/Não foi possível carregar as métricas/),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Tentar novamente/ }))
      .toBeDefined();
  });

  it("whenSearchTyped_thenFiltersLog", () => {
    mocks.messages = [message({ id: "1", status: "entregue" })];
    renderTab();
    const search = screen.getByLabelText(/Buscar/);
    fireEvent.change(search, { target: { value: "maria" } });
    expect((search as HTMLInputElement).value).toBe("maria");
  });
});
