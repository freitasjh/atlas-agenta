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

import { WhatsAppPage } from "@/app/config/whatsapp/WhatsAppPage";

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  canManage: true,
  instance: {
    id: "inst-1",
    tenant_id: "tenant-1",
    evolution_instance_name: "atlas-1",
    connection_status: "conectado",
    last_connected_at: "2026-01-01T12:00:00.000Z",
    created_at: "2026-01-01T12:00:00.000Z",
  } as unknown,
  instanceLoading: false,
  instanceError: false,
  refetch: vi.fn(),
  pair: { mutateAsync: vi.fn() },
  messages: [] as unknown[],
  messagesLoading: false,
  messagesError: false,
  customers: [] as unknown[],
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: mocks.isAdmin,
    canManageWhatsAppConnection: mocks.canManage,
  }),
}));

vi.mock("@/hooks/useWhatsAppInstance", () => ({
  useWhatsAppInstance: () => ({
    data: mocks.instance,
    isLoading: mocks.instanceLoading,
    isError: mocks.instanceError,
    isSuccess: !mocks.instanceLoading && !mocks.instanceError,
    refetch: mocks.refetch,
  }),
  usePairWhatsApp: () => mocks.pair,
}));

vi.mock("@/hooks/useMessages", () => ({
  useRecentMessages: () => ({
    data: mocks.messages,
    isLoading: mocks.messagesLoading,
    isError: mocks.messagesError,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({ data: mocks.customers, isLoading: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));

afterEach(() => {
  cleanup();
  mocks.isAdmin = true;
  mocks.canManage = true;
  mocks.instanceLoading = false;
  mocks.instanceError = false;
  mocks.messages = [];
  mocks.customers = [];
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <WhatsAppPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("WhatsAppPage tabs (RF-39/RF-41)", () => {
  it("whenLoaded_thenShowsThreeTabsStartingAtConexao", () => {
    renderPage();
    expect(
      screen.getByRole("tablist", { name: /Seções do WhatsApp/ }),
    ).toBeDefined();
    expect(screen.getByRole("tab", { name: "Conexão" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Mensagens" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Métricas" })).toBeDefined();
    expect(screen.getByText(/WhatsApp conectado/)).toBeDefined();
  });

  it("whenMensagensTab_thenShowsRecentMessages", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Mensagens" }));
    expect(screen.getByText("Mensagens recentes")).toBeDefined();
    expect(
      screen.getByText(/Nenhuma mensagem enviada ainda/),
    ).toBeDefined();
  });

  it("whenAdminOnMetricas_thenShowsKpis", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Métricas" }));
    expect(screen.getByText("Desempenho do canal")).toBeDefined();
  });

  it("whenNonAdminOnMetricas_thenDeniedWithoutRequest", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("sem rede"));
    mocks.isAdmin = false;
    try {
      renderPage();
      fireEvent.click(screen.getByRole("tab", { name: "Métricas" }));
      expect(
        screen.getByText(/Métricas restritas a administradores/),
      ).toBeDefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("whenNonManager_thenConnectionWithoutCta", () => {
    mocks.canManage = false;
    mocks.instance = null;
    try {
      renderPage();
      expect(
        screen.getByText(/Peça a um administrador para conectar/),
      ).toBeDefined();
    } finally {
      mocks.instance = {
        id: "inst-1",
        tenant_id: "tenant-1",
        evolution_instance_name: "atlas-1",
        connection_status: "conectado",
        last_connected_at: "2026-01-01T12:00:00.000Z",
        created_at: "2026-01-01T12:00:00.000Z",
      } as unknown;
    }
  });
});
