// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useInvitations", () => ({
  useInviteMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ConviteProfissionalDialog } from "@/app/config/profissionais/ConviteProfissionalDialog";

afterEach(() => cleanup());

describe("ConviteProfissionalDialog", () => {
  it("renderiza dialog com campo de e-mail e botão de envio", () => {
    render(
      <ConviteProfissionalDialog
        open={true}
        onOpenChange={() => {}}
        professionalId="p-1"
        professionalName="Ana"
      />,
    );
    expect(screen.getByText("Convidar para acesso")).toBeTruthy();
    expect(screen.getByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByText("Enviar convite")).toBeTruthy();
  });
});