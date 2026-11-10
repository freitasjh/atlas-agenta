// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  pending: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canRegisterPayments: true,
    canManageAppointments: true,
    canScheduleForAnyProfessional: mocks.canScheduleForAnyProfessional,
    isAdmin: true,
    isProfessional: false,
    isReceptionist: false,
    canViewFinancials: true,
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
  useCreateWalkIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCreateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    SelectItem: ({ children, value }: SelectProps) =>
      React.createElement("option", { value }, children),
  };
});

vi.mock("@/app/agenda/pagamentos/PaymentCaptureDialog", async () => {
  const React = await import("react");
  return {
    // Stub mínimo: expõe `onCompleted` para o teste dirigir a conclusão da venda.
    PaymentCaptureDialog: (props: { onCompleted?: () => void }) =>
      React.createElement(
        "button",
        { type: "button", onClick: () => props.onCompleted?.() },
        "concluir-venda",
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
  mocks.payments = true;
  mocks.canScheduleForAnyProfessional = true;
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
});
