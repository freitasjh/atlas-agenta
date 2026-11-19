// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DepositStep } from "@/public/DepositStep";
import type { DepositCharge } from "@/lib/validations/deposit";

afterEach(cleanup);

const CHARGE: DepositCharge = {
  id: "charge-1",
  status: "pendente",
  amountCents: 3000,
  pixQrCode: null,
  pixCopiaECola: "000201pix-copia-e-cola-teste",
  expiresAt: null,
};

const BASE = {
  serviceName: "Corte",
  amountCents: 3000,
  deadlineHours: 24,
  refundHint: "Reembolso total ao cancelar até o prazo.",
} as const;

describe("DepositStep — ADR-12 / RF-02", () => {
  it("loading: anuncia geração da cobrança", () => {
    render(<DepositStep {...BASE} status="loading" />);
    expect(screen.getByText(/gerando cobrança/i)).toBeDefined();
    expect(screen.getByText(/R\$\s*30,00/)).toBeDefined();
  });

  it("ready: exibe status, copia-e-cola e botão de copiar", () => {
    render(<DepositStep {...BASE} status="ready" charge={CHARGE} />);
    expect(screen.getByText(/aguardando depósito/i)).toBeDefined();
    expect(screen.getByText(/pix-copia-e-cola-teste/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /copiar código pix/i }),
    ).toBeDefined();
  });

  it("error: mostra alerta e tenta de novo", () => {
    let retried = 0;
    render(
      <DepositStep
        {...BASE}
        status="error"
        errorMessage="Falha ao gerar"
        onRetry={() => {
          retried += 1;
        }}
      />,
    );
    expect(screen.getByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(retried).toBe(1);
  });

  it("exibe prazo e aviso de reembolso", () => {
    render(<DepositStep {...BASE} status="idle" />);
    expect(screen.getByText(/em até 24 horas/i)).toBeDefined();
    expect(screen.getByText(/reembolso total/i)).toBeDefined();
  });
});
