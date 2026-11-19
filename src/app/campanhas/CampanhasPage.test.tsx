// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entitlements: null as unknown,
  campaigns: [] as Array<Record<string, unknown>>,
  campaignsLoading: false,
  campaignsError: false,
  refetch: vi.fn(),
  templates: [] as Array<Record<string, unknown>>,
  services: [] as Array<Record<string, unknown>>,
  save: { mutateAsync: vi.fn(), isPending: false },
  enqueue: { mutateAsync: vi.fn(), isPending: false },
  preview: {
    data: null as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  metrics: {
    data: null as unknown,
    isLoading: false,
  },
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/useCampaigns", () => ({
  useCampaigns: () => ({
    data: mocks.campaigns,
    isLoading: mocks.campaignsLoading,
    isError: mocks.campaignsError,
    refetch: mocks.refetch,
  }),
  useSaveCampaign: () => mocks.save,
  useEnqueueCampaign: () => mocks.enqueue,
  useCampaignPreview: () => mocks.preview,
  useCampaignMetrics: () => mocks.metrics,
}));

vi.mock("@/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({
    data: mocks.templates,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: mocks.services, isLoading: false }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: true,
    isReceptionist: false,
    isProfessional: false,
    canManageMessageTemplates: true,
  }),
}));

import { CampanhasPage } from "@/app/campanhas/CampanhasPage";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CampanhasPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

function baseCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "camp-1",
    tenant_id: "t1",
    name: "Reativação janeiro",
    preset: "win_back",
    template_id: "tpl-1",
    segment: { last_visit_before_days: 60 },
    scheduled_at: null,
    status: "rascunho",
    created_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("CampanhasPage", () => {
  it("lista campanhas com preset e status", () => {
    mocks.entitlements = { campanhas: true };
    mocks.campaignsLoading = false;
    mocks.campaignsError = false;
    mocks.campaigns = [
      baseCampaign(),
      baseCampaign({ id: "camp-2", name: "Aniversariantes", preset: "birthday", status: "agendada" }),
    ];
    renderPage();
    // Tabela desktop + cards mobile rendem juntos (um escondido por CSS).
    expect(screen.getAllByText("Reativação janeiro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aniversariantes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Win-back").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rascunho").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Agendada").length).toBeGreaterThan(0);
  });

  it("abre diálogo de criação com presets e biblioteca de templates", () => {
    mocks.entitlements = { campanhas: true };
    mocks.campaigns = [];
    mocks.templates = [
      { id: "tpl-1", template_key: "confirmacao", body: "Olá {nome}", active: true },
    ];
    renderPage();
    fireEvent.click(screen.getByText("Nova campanha"));
    expect(screen.getByLabelText("Nome da campanha")).toBeTruthy();
    expect(screen.getByText("Win-back")).toBeTruthy();
    expect(screen.getByText("Aniversário")).toBeTruthy();
    expect(screen.getByText("Rebooking")).toBeTruthy();
    expect(screen.getByText("Personalizada")).toBeTruthy();
    // Biblioteca de templates reutilizada (TemplatesMensagemPage como fonte):
    // abre o select e confere a opção (rótulo + início do corpo).
    fireEvent.click(screen.getByText("Escolha um modelo da biblioteca..."));
    expect(
      screen.getAllByText((_content, element) => element?.textContent?.includes("Olá {nome}") === true).length,
    ).toBeGreaterThan(0);
  });

  it("exibe preview com contagem e excluídos por opt-in", () => {
    mocks.entitlements = { campanhas: true };
    mocks.campaigns = [baseCampaign()];
    mocks.preview.data = {
      campaign_id: "camp-1",
      total: 120,
      eligible: 100,
      excluded_opt_in: 20,
    };
    renderPage();
    fireEvent.click(screen.getAllByText("Reativação janeiro")[0]);
    expect(screen.getByText("100 elegíveis")).toBeTruthy();
    expect(screen.getByText(/20 excluídos por opt-in/)).toBeTruthy();
  });

  it("exibe métricas de envio, entrega, leitura, resposta e conversão", () => {
    mocks.entitlements = { campanhas: true };
    mocks.campaigns = [baseCampaign({ status: "concluída" })];
    mocks.metrics.data = {
      campaign_id: "camp-1",
      counts: {
        sent: 90,
        delivered: 85,
        read: 60,
        replied: 12,
        converted: 6,
        failed: 2,
        excluded_opt_in: 20,
      },
    };
    renderPage();
    fireEvent.click(screen.getAllByText("Reativação janeiro")[0]);
    expect(screen.getByText("90")).toBeTruthy();
    expect(screen.getByText("Enviadas")).toBeTruthy();
    expect(screen.getByText("Entregues")).toBeTruthy();
    expect(screen.getByText("Lidas")).toBeTruthy();
    expect(screen.getByText("Respostas")).toBeTruthy();
    expect(screen.getByText("Conversões")).toBeTruthy();
  });

  it("sem entitlement mostra upsell e bloqueia criação", () => {
    mocks.entitlements = { campanhas: false };
    mocks.campaigns = [];
    renderPage();
    expect(screen.getByText(/recurso não incluído no plano atual/i)).toBeTruthy();
    expect(screen.getByText("Ver planos")).toBeTruthy();
    const novo = screen.getByText("Nova campanha");
    expect(novo.closest("button")?.disabled).toBe(true);
  });
});
