// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useAutoSendConfirmation } from "@/hooks/useAutoSendConfirmation";

const mocks = vi.hoisted(() => ({
  optIn: true,
  templateActive: true,
  sendMutate: vi.fn(),
}));

vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({ mutateAsync: mocks.sendMutate }),
}));

vi.mock("@/hooks/useMessageTemplates", () => ({
  useMessageTemplates: () => ({
    data: [{ template_key: "confirmacao", active: mocks.templateActive }],
  }),
}));

const NOW = new Date("2026-11-10T12:00:00.000Z").getTime();

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    customer_id: "55555555-5555-4555-8555-555555555555",
    customers: { name: "Ana", whatsapp_opt_in: mocks.optIn },
    starts_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  } as never;
}

describe("useAutoSendConfirmation — consumo T2.0 (ADR-07)", () => {
  function renderAutoSend() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return renderHook(() => useAutoSendConfirmation(), { wrapper });
  }

  it("dispara sender existente quando opt-in + toggle + janela", async () => {
    mocks.optIn = true;
    mocks.templateActive = true;
    mocks.sendMutate.mockResolvedValue({ outcome: "sent" });
    const { result } = renderAutoSend();
    const outcome = await result.current.maybeSendConfirmation(
      appointment(),
      NOW,
    );
    expect(outcome).toBe("sent");
    expect(mocks.sendMutate).toHaveBeenCalledWith({
      template: "confirmacao",
      customerId: "55555555-5555-4555-8555-555555555555",
      appointmentId: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("pula silencioso sem opt-in (nenhuma chamada)", async () => {
    mocks.optIn = false;
    mocks.templateActive = true;
    mocks.sendMutate.mockClear();
    const { result } = renderAutoSend();
    const outcome = await result.current.maybeSendConfirmation(
      appointment(),
      NOW,
    );
    expect(outcome).toBe("skipped");
    expect(mocks.sendMutate).not.toHaveBeenCalled();
  });

  it("pula silencioso com toggle desligado", async () => {
    mocks.optIn = true;
    mocks.templateActive = false;
    mocks.sendMutate.mockClear();
    const { result } = renderAutoSend();
    const outcome = await result.current.maybeSendConfirmation(
      appointment(),
      NOW,
    );
    expect(outcome).toBe("skipped");
    expect(mocks.sendMutate).not.toHaveBeenCalled();
  });

  it("falha de envio vira 'failed', nunca throw (status já mudou)", async () => {
    mocks.optIn = true;
    mocks.templateActive = true;
    mocks.sendMutate.mockRejectedValue(new Error("offline"));
    const { result } = renderAutoSend();
    const outcome = await result.current.maybeSendConfirmation(
      appointment(),
      NOW,
    );
    expect(outcome).toBe("failed");
  });
});
