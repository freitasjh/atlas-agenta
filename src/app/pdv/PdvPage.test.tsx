// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ChangeEvent, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PdvPage } from "@/app/pdv/PdvPage";
import { WalkInBadge } from "@/app/pdv/WalkInBadge";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

const mocks = vi.hoisted(() => ({
  payments: true as boolean | null,
  canScheduleForAnyProfessional: true,
  professionals: [
    {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Beto",
      profile_id: "u1",
      active: true,
    },
  ],
  services: [
    {
      id: "55555555-5555-5555-5555-555555555555",
      name: "Corte",
      price_cents: 5000,
      duration_minutes: 30,
      active: true,
    },
  ],
  products: [] as Array<Record<string, unknown>>,
  entitlements: null as unknown,
  permissions: { canRegisterPayments: true, canScheduleForAnyProfessional: true, canViewCommission: true, isAdmin: true, isReceptionist: false } as Record<string, unknown>,
  pending: [] as Array<Record<string, unknown>>,
  createWalkIn: { mutateAsync: vi.fn(), isPending: false },
  createCustomer: { mutateAsync: vi.fn(), isPending: false },
  validateCoupon: { mutateAsync: vi.fn(), isPending: false },
  validateGift: { mutateAsync: vi.fn(), isPending: false },
  applyCoupon: { mutateAsync: vi.fn(), isPending: false },
  redeemGift: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canRegisterPayments: mocks.permissions.canRegisterPayments,
    canManageAppointments: true,
    canScheduleForAnyProfessional: mocks.canScheduleForAnyProfessional,
    canViewCommission: mocks.permissions.canViewCommission,
    isAdmin: mocks.permissions.isAdmin,
    isProfessional: false,
    isReceptionist: mocks.permissions.isReceptionist,
    canViewFinancials: mocks.permissions.isAdmin,
  }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ payments: mocks.payments, commission: true, combos: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: { timezone: "America/Sao_Paulo" },
    userId: "u1",
    role: "admin",
  }),
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: mocks.professionals, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: mocks.services, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useCombos", () => ({
  useCombos: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ data: mocks.products, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/useAppointments", () => ({
  useAppointments: () => ({
    data: mocks.pending,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWalkIn", () => ({
  newCreationKey: () => "66666666-6666-6666-6666-666666666666",
  useCreateWalkIn: () => mocks.createWalkIn,
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCreateCustomer: () => mocks.createCustomer,
}));

vi.mock("@/hooks/useFidelidade", () => ({
  useValidateCoupon: () => mocks.validateCoupon,
  useValidateGiftCard: () => mocks.validateGift,
  useApplyCouponToClosing: () => mocks.applyCoupon,
  useRedeemGiftCard: () => mocks.redeemGift,
}));

/**
 * `Select` do design system vira um `<select>` nativo neste teste: o Radix
 * monta as opções num portal com posicionamento medido (e usa
 * `hasPointerCapture`), que o happy-dom não resolve. A troca é só do primitivo
 * de entrada — a lógica sob teste é o reset do formulário do PDV.
 */
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");

  type SelectProps = {
    children?: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  };

  return {
    Select: ({ children, value, onValueChange, disabled }: SelectProps) => {
      // `nenhum` é sentinela visual do shadcn para "vazio" (nunca valor de domínio).
      const normalized = value === "nenhum" ? "" : (value ?? "");
      return React.createElement(
        "select",
        {
          value: normalized,
          disabled,
          onChange: (event: ChangeEvent<HTMLSelectElement>) =>
            onValueChange?.(event.target.value),
        },
        React.createElement("option", { value: "" }, ""),
        children,
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: SelectProps) =>
      React.createElement(React.Fragment, null, children),
    SelectItem: ({ children, value, disabled }: SelectProps & { disabled?: boolean }) =>
      React.createElement("option", { value, disabled }, children),
  };
});

vi.mock("@/app/agenda/pagamentos/PaymentCaptureDialog", async () => {
  const React = await import("react");
  return {
    // Stub mínimo: expõe `onCompleted` para o teste dirigir a conclusão da
    // venda e o `totalCents` capturado (prova do total final com fidelidade).
    PaymentCaptureDialog: (props: {
      onCompleted?: () => void;
      appointment: { totalCents: number };
    }) =>
      React.createElement(
        "div",
        null,
        React.createElement(
          "span",
          { "data-testid": "capture-total" },
          String(props.appointment.totalCents),
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => props.onCompleted?.() },
          "concluir-venda",
        ),
      ),
  };
});

function wrapper(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(
    QueryClientProvider,
    { client },
    createElement(MemoryRouter, null, children),
  );
}

afterEach(() => {
  cleanup();
  mocks.pending = [];
  mocks.products = [];
  mocks.entitlements = null;
  mocks.permissions = { canRegisterPayments: true, canScheduleForAnyProfessional: true, canViewCommission: true, isAdmin: true, isReceptionist: false };
  mocks.payments = true;
  mocks.canScheduleForAnyProfessional = true;
  vi.clearAllMocks();
});

/** `select` nativo (mock do shadcn Select) que contém a opção com o texto dado. */
function selectWithOption(container: HTMLElement, optionText: string): HTMLSelectElement {
  const select = Array.from(container.querySelectorAll("select")).find((candidate) =>
    Array.from(candidate.options).some((option) =>
      (option.textContent ?? "").includes(optionText),
    ),
  );
  if (!select) throw new Error(`select com a opção "${optionText}" não encontrado`);
  return select;
}

/** Venda em andamento usada para abrir o diálogo de pagamento pela lista. */
function pendingAppointment(): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "22222222-2222-2222-2222-222222222222",
    origin: "walk_in",
    customer_id: null,
    professional_id: "44444444-4444-4444-4444-444444444444",
    service_id: "55555555-5555-5555-5555-555555555555",
    combo_id: null,
    starts_at: "2026-11-09T15:00:00.000Z",
    ends_at: "2026-11-09T15:30:00.000Z",
    price_cents: 5000,
    status: "em_atendimento",
    confirmed_at: null,
    confirmed_via: null,
    created_at: "2026-11-09T14:55:00.000Z",
    customers: null,
    services: { name: "Corte", duration_minutes: 30, price_cents: 5000 },
    combos: null,
    professionals: { name: "Beto" },
    commission_cents: null,
  };
}

describe("PdvPage — PDV balcão (ADR-23)", () => {
  it("renderiza o formulário de venda quando payments é true", () => {
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    expect(screen.getByText(paymentsMessages.pdv.title)).toBeTruthy();
    expect(screen.getByText(paymentsMessages.pdv.createSale)).toBeTruthy();
    expect(screen.getByText(paymentsMessages.pdv.pendingList)).toBeTruthy();
  });

  it("mostra painel de ramo quando payments é false", () => {
    mocks.payments = false;
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    expect(screen.getByText(paymentsMessages.pdv.segmentOnlyDescription)).toBeTruthy();
  });

  it("exibe Cliente de balcão na lista A concluir hoje", () => {
    mocks.pending = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        tenant_id: "22222222-2222-2222-2222-222222222222",
        origin: "walk_in",
        customer_id: null,
        professional_id: "44444444-4444-4444-4444-444444444444",
        service_id: "55555555-5555-5555-5555-555555555555",
        combo_id: null,
        starts_at: "2026-11-09T15:00:00.000Z",
        ends_at: "2026-11-09T15:30:00.000Z",
        price_cents: 5000,
        status: "em_atendimento",
        confirmed_at: null,
        confirmed_via: null,
        created_at: "2026-11-09T14:55:00.000Z",
        customers: null,
        services: { name: "Corte", duration_minutes: 30, price_cents: 5000 },
        combos: null,
        professionals: { name: "Beto" },
        commission_cents: null,
      },
    ];
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    expect(screen.getByText("Cliente de balcão")).toBeTruthy();
    expect(screen.getByText("Balcão")).toBeTruthy();
  });

  it("WalkInBadge renderiza o selo Balcão", () => {
    render(createElement(WalkInBadge));
    expect(screen.getByText("Balcão")).toBeTruthy();
  });

  it("marcar 'Identificar cliente' revela os campos e desmarcar limpa", () => {
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    expect(screen.queryByLabelText(paymentsMessages.pdv.customerName)).toBeNull();
    expect(screen.getByText(paymentsMessages.pdv.anonymousHint)).toBeTruthy();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const name = screen.getByLabelText(paymentsMessages.pdv.customerName) as HTMLInputElement;
    const phone = screen.getByLabelText(paymentsMessages.pdv.customerPhone) as HTMLInputElement;
    expect(name).toBeTruthy();
    expect(phone).toBeTruthy();

    fireEvent.change(name, { target: { value: "Ana" } });
    fireEvent.change(phone, { target: { value: "11999998888" } });
    expect(name.value).toBe("Ana");

    fireEvent.click(checkbox);
    expect(screen.queryByLabelText(paymentsMessages.pdv.customerName)).toBeNull();
    expect(screen.getByText(paymentsMessages.pdv.anonymousHint)).toBeTruthy();

    fireEvent.click(checkbox);
    expect(
      (screen.getByLabelText(paymentsMessages.pdv.customerName) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText(paymentsMessages.pdv.customerPhone) as HTMLInputElement).value,
    ).toBe("");
  });

  it("identificar revela o checkbox de opt-in do WhatsApp (LGPD)", () => {
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    expect(screen.queryByLabelText(paymentsMessages.pdv.whatsappOptIn)).toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));

    const optIn = screen.getByLabelText(paymentsMessages.pdv.whatsappOptIn) as HTMLInputElement;
    expect(optIn).toBeTruthy();
    expect(optIn.getAttribute("aria-checked")).toBe("false");
  });

  it("submeter só o nome mostra erro acessível de WhatsApp (submit não fica mudo)", async () => {
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    fireEvent.click(screen.getByRole("checkbox"));
    const name = screen.getByLabelText(paymentsMessages.pdv.customerName);
    fireEvent.change(name, { target: { value: "Ana" } });

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(paymentsMessages.pdv.createSale) }),
    );

    const alert = await screen.findByText("Informe o WhatsApp para identificar o cliente.");
    expect(alert.getAttribute("role")).toBe("alert");

    const phone = screen.getByLabelText(paymentsMessages.pdv.customerPhone) as HTMLInputElement;
    expect(phone.getAttribute("aria-invalid")).toBe("true");
    expect(phone.getAttribute("aria-describedby")).toBe("pdv-cliente-fone-erro");
  });

  it("concluir a venda limpa o formulário inteiro (identify + campos + seleção)", async () => {
    mocks.pending = [pendingAppointment()];
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    // Preenche a identificação da venda em andamento.
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(paymentsMessages.pdv.customerName), {
      target: { value: "Ana" },
    });
    fireEvent.change(screen.getByLabelText(paymentsMessages.pdv.customerPhone), {
      target: { value: "11999998888" },
    });

    // Preenche profissional e serviço ANTES de concluir — sem isso a asserção
    // de reset seria tautológica (nunca preenchidos, nunca resetados).
    const professionalSelect = selectWithOption(container, "Beto");
    const serviceSelect = selectWithOption(container, "Corte");
    fireEvent.change(professionalSelect, { target: { value: mocks.professionals[0].id } });
    fireEvent.change(serviceSelect, { target: { value: mocks.services[0].id } });
    expect(professionalSelect.value).toBe(mocks.professionals[0].id);
    expect(serviceSelect.value).toBe(mocks.services[0].id);

    // Abre o pagamento pela lista e conclui (stub do diálogo).
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.pdv.openPayment }),
    );
    fireEvent.click(screen.getByRole("button", { name: "concluir-venda" }));

    // `identify` volta a falso: campos ocultos e dica de anônimo visível.
    expect(screen.queryByLabelText(paymentsMessages.pdv.customerName)).toBeNull();
    expect(screen.getByText(paymentsMessages.pdv.anonymousHint)).toBeTruthy();
    // Estado inicial não tem erro visível (reset limpa o formState).
    expect(screen.queryByText("Selecione o serviço.")).toBeNull();

    // Profissional e serviço voltaram ao valor inicial (vazio) — prova real do reset.
    expect(selectWithOption(container, "Beto").value).toBe("");
    expect(selectWithOption(container, "Corte").value).toBe("");

    // Reabrir mostra os campos vazios.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      (screen.getByLabelText(paymentsMessages.pdv.customerName) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText(paymentsMessages.pdv.customerPhone) as HTMLInputElement).value,
    ).toBe("");

    // Submit acusa os dois campos obrigatórios: estão vazios de verdade.
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(paymentsMessages.pdv.createSale) }),
    );
    expect(await screen.findByText("Selecione o profissional.")).toBeTruthy();
    expect(await screen.findByText("Selecione o serviço.")).toBeTruthy();
  });

  it("papel professional repopula o próprio profissional após o reset", async () => {
    mocks.canScheduleForAnyProfessional = false;
    mocks.pending = [pendingAppointment()];
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    // O Select travado já nasce com o profissional do usuário (ownProfessional).
    const professionalSelect = selectWithOption(container, "Beto");
    expect(professionalSelect.value).toBe(mocks.professionals[0].id);

    // Preenche o serviço para provar que o reset realmente roda.
    const serviceSelect = selectWithOption(container, "Corte");
    fireEvent.change(serviceSelect, { target: { value: mocks.services[0].id } });
    expect(serviceSelect.value).toBe(mocks.services[0].id);

    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.pdv.openPayment }),
    );
    fireEvent.click(screen.getByRole("button", { name: "concluir-venda" }));

    // O reset rodou: o serviço voltou ao inicial…
    expect(selectWithOption(container, "Corte").value).toBe("");
    // …e o profissionalId foi REAPLICADO com o próprio id (nunca fica vazio).
    expect(selectWithOption(container, "Beto").value).toBe(mocks.professionals[0].id);

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(paymentsMessages.pdv.createSale) }),
    );

    expect(await screen.findByText("Selecione o serviço.")).toBeTruthy();
    expect(screen.queryByText("Selecione o profissional.")).toBeNull();
  });

  it("segmented control alterna para Produto e exibe select de produto", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: true };
    mocks.products = [
      { id: "p1", tenant_id: "t1", name: "Pomada", sku: null, category: "retail", unit: "un", cost_cents: 500, price_cents: 1000, min_qty: 1, active: true, commission_pct: 10, stock_qty: 5, created_at: "2026-01-01T00:00:00Z" },
    ];
    mocks.canScheduleForAnyProfessional = true;
    render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    const tab = screen.getByRole("tab", { name: paymentsMessages.pdv.segmentedProduct });
    fireEvent.click(tab);
    expect(screen.getByText(/Pomada/)).toBeTruthy();
    // preço read-only visível
    expect(screen.getByText(paymentsMessages.pdv.unitPrice)).toBeTruthy();
  });

  it("produto esgotado aparece desabilitado com alerta", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.products = [
      { id: "p2", tenant_id: "t1", name: "Gel", sku: null, category: "retail", unit: "un", cost_cents: 300, price_cents: 800, min_qty: 1, active: true, commission_pct: 0, stock_qty: 0, created_at: "2026-01-01T00:00:00Z" },
    ];
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    fireEvent.click(screen.getByRole("tab", { name: paymentsMessages.pdv.segmentedProduct }));
    const select = Array.from(container.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.textContent?.includes("Gel"))) as HTMLSelectElement;
    const option = Array.from(select.options).find((o) => o.textContent?.includes("Gel"));
    expect(option?.disabled).toBe(true);
    expect(screen.getByText(paymentsMessages.pdv.outOfStockAlert)).toBeTruthy();
  });

  it("qty maior que estoque bloqueia submit", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.products = [
      { id: "p3", tenant_id: "t1", name: "Shampoo", sku: null, category: "retail", unit: "un", cost_cents: 300, price_cents: 1200, min_qty: 1, active: true, commission_pct: 0, stock_qty: 2, created_at: "2026-01-01T00:00:00Z" },
    ];
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    fireEvent.click(screen.getByRole("tab", { name: paymentsMessages.pdv.segmentedProduct }));
    const select = Array.from(container.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.textContent?.includes("Shampoo"))) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "p3" } });
    const qtyInput = screen.getByLabelText(paymentsMessages.pdv.qty) as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: "5" } });
    const btn = screen.getByRole("button", { name: new RegExp(paymentsMessages.pdv.createSale) });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(paymentsMessages.pdv.insufficientStock)).toBeTruthy();
  });

  it("total calculado para venda de produto", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.products = [
      { id: "p4", tenant_id: "t1", name: "Cera", sku: null, category: "retail", unit: "un", cost_cents: 400, price_cents: 1500, min_qty: 1, active: true, commission_pct: 0, stock_qty: 10, created_at: "2026-01-01T00:00:00Z" },
    ];
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    fireEvent.click(screen.getByRole("tab", { name: paymentsMessages.pdv.segmentedProduct }));
    const select = Array.from(container.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.textContent?.includes("Cera"))) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "p4" } });
    const qtyInput = screen.getByLabelText(paymentsMessages.pdv.qty) as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: "3" } });
    // 3 * 1500 = 4500 cents => R$ 45,00
    expect(screen.getByText(/R\$\s*45,00/)).toBeTruthy();
  });

  it("comissão preview visível só com entitlement e canViewCommission", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: true };
    mocks.products = [
      { id: "p5", tenant_id: "t1", name: "PomadaX", sku: null, category: "retail", unit: "un", cost_cents: 500, price_cents: 1000, min_qty: 1, active: true, commission_pct: 10, stock_qty: 5, created_at: "2026-01-01T00:00:00Z" },
    ];
    // admin canViewCommission true (mock default)
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    fireEvent.click(screen.getByRole("tab", { name: paymentsMessages.pdv.segmentedProduct }));
    const select = Array.from(container.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.textContent?.includes("PomadaX"))) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "p5" } });
    expect(screen.getByText(/Comissão estimada/i)).toBeTruthy();
  });

  it("receptionist não vê comissão preview", () => {
    mocks.permissions = { canRegisterPayments: true, canScheduleForAnyProfessional: true, canViewCommission: false, isAdmin: false, isReceptionist: true };
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: true };
    mocks.products = [
      { id: "p6", tenant_id: "t1", name: "PomadaR", sku: null, category: "retail", unit: "un", cost_cents: 500, price_cents: 1000, min_qty: 1, active: true, commission_pct: 10, stock_qty: 5, created_at: "2026-01-01T00:00:00Z" },
    ];
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });
    fireEvent.click(screen.getByRole("tab", { name: paymentsMessages.pdv.segmentedProduct }));
    const select = Array.from(container.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.textContent?.includes("PomadaR"))) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "p6" } });
    expect(screen.queryByText(/Comissão estimada/i)).toBeNull();
    // restore
    mocks.permissions = { canRegisterPayments: true, canScheduleForAnyProfessional: true, canViewCommission: true, isAdmin: true, isReceptionist: false };
  });

  it("fidelidade: submit aplica cupom+gift no fechamento (RPC args) e captura o total final", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.createCustomer.mutateAsync = vi.fn().mockResolvedValue({ id: "c1" });
    mocks.createWalkIn.mutateAsync = vi
      .fn()
      .mockResolvedValue({ appointmentId: "aaaaaaaa-1111-1111-1111-111111111111" });
    mocks.validateGift.mutateAsync = vi
      .fn()
      .mockResolvedValue({ valid: true, balance_cents: 3000, reason: null });
    mocks.applyCoupon.mutateAsync = vi.fn().mockResolvedValue({
      appointment_id: "aaaaaaaa-1111-1111-1111-111111111111",
      coupon_id: "cp1",
      discount_cents: 1000,
      total_final_cents: 4000,
      applied: true,
      replayed: false,
    });
    mocks.redeemGift.mutateAsync = vi.fn().mockResolvedValue({
      appointment_id: "aaaaaaaa-1111-1111-1111-111111111111",
      gift_card_id: "g1",
      amount_cents: 3000,
      payment_id: "pay1",
      redeemed: true,
      replayed: false,
    });

    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    fireEvent.change(selectWithOption(container, "Beto"), {
      target: { value: mocks.professionals[0].id },
    });
    fireEvent.change(selectWithOption(container, "Corte"), {
      target: { value: mocks.services[0].id },
    });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(paymentsMessages.pdv.customerName), {
      target: { value: "Ana" },
    });
    fireEvent.change(screen.getByLabelText(paymentsMessages.pdv.customerPhone), {
      target: { value: "11999998888" },
    });

    // Cupom pré-criação: sem atendimento real, fica pendente para o fechamento.
    fireEvent.change(screen.getByLabelText("Cupom"), { target: { value: "VOLTA10" } });
    fireEvent.click(screen.getByRole("button", { name: /aplicar cupom/i }));
    expect(await screen.findByText(/será validado no fechamento/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Gift card"), { target: { value: "PRESENTE-1" } });
    fireEvent.click(screen.getByRole("button", { name: /resgatar gift card/i }));
    await waitFor(() => expect(mocks.validateGift.mutateAsync).toHaveBeenCalledWith("PRESENTE-1"));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(paymentsMessages.pdv.createSale) }),
    );

    // Contrato dos RPCs: appointmentId real + codes + amounts idempotentes.
    await waitFor(() => expect(mocks.applyCoupon.mutateAsync).toHaveBeenCalled());
    expect(mocks.applyCoupon.mutateAsync).toHaveBeenCalledWith({
      appointmentId: "aaaaaaaa-1111-1111-1111-111111111111",
      code: "VOLTA10",
      idempotencyKey: expect.any(String),
    });
    await waitFor(() => expect(mocks.redeemGift.mutateAsync).toHaveBeenCalled());
    expect(mocks.redeemGift.mutateAsync).toHaveBeenCalledWith({
      appointmentId: "aaaaaaaa-1111-1111-1111-111111111111",
      code: "PRESENTE-1",
      amountCents: 3000,
      idempotencyKey: expect.any(String),
    });

    // Total capturado = 5000 − 1000 (cupom, servidor) − 3000 (gift).
    expect((await screen.findByTestId("capture-total")).textContent).toBe("1000");
  });

  it("fidelidade: concluir a venda limpa loyalty (cupom/gift não vazam)", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.pending = [pendingAppointment()];
    mocks.validateGift.mutateAsync = vi
      .fn()
      .mockResolvedValue({ valid: true, balance_cents: 3000, reason: null });
    const { container } = render(wrapper(createElement(PdvPage)), { wrapper: undefined });

    fireEvent.change(selectWithOption(container, "Corte"), {
      target: { value: mocks.services[0].id },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Gift card"), { target: { value: "PRESENTE-1" } });
    fireEvent.click(screen.getByRole("button", { name: /resgatar gift card/i }));
    // Status de fidelidade visível antes da conclusão.
    expect(await screen.findByRole("status")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.pdv.openPayment }),
    );
    fireEvent.click(screen.getByRole("button", { name: "concluir-venda" }));

    // Reset limpou loyalty: sem status residual para a próxima venda.
    expect(screen.queryByRole("status")).toBeNull();
  });

});
