// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DepositBadge } from "@/app/agenda/DepositBadge";

afterEach(cleanup);

describe("DepositBadge — ADR-12 / RF-06", () => {
  it("renderiza o rótulo pt-BR com papel de status", () => {
    render(<DepositBadge />);
    const badge = screen.getByRole("status", { name: /aguardando depósito/i });
    expect(badge.textContent).toMatch(/aguardando depósito/i);
  });
});
