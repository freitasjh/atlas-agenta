// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BannerAlergia } from "@/app/agenda/prontuario/BannerAlergia";

afterEach(cleanup);

describe("BannerAlergia", () => {
  it("indisponível: estado neutro sem afirmar vazio", () => {
    render(
      <BannerAlergia allergies={undefined} isLoading={false} unavailable />,
    );
    expect(
      screen.getByText("Dados de alergia indisponíveis sem o recurso Prontuário."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Sem alergias registradas para este atendimento."),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("indisponível vence alergia presente (sem dados não afirma nada)", () => {
    render(
      <BannerAlergia allergies="Penicilina" isLoading={false} unavailable />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByText("Dados de alergia indisponíveis sem o recurso Prontuário."),
    ).toBeTruthy();
  });

  it("loading: estado de verificação", () => {
    render(<BannerAlergia allergies={undefined} isLoading />);
    expect(screen.getByText("Verificando alergias…")).toBeTruthy();
  });

  it("vazio afirmativo só com dados carregados", () => {
    render(<BannerAlergia allergies={null} isLoading={false} />);
    expect(
      screen.getByText("Sem alergias registradas para este atendimento."),
    ).toBeTruthy();
  });

  it("com alergia: banner destrutivo com alert", () => {
    render(<BannerAlergia allergies="Penicilina" isLoading={false} />);
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Penicilina");
  });
});
