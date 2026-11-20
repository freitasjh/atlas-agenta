// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TestimonialCard } from "@/components/marketing/testimonial-card";

afterEach(cleanup);

describe("TestimonialCard", () => {
  it("renderiza sem crash", () => {
    render(<TestimonialCard quote="Quote" name="Name" />);
    expect(screen.getByText("Quote")).toBeDefined();
    expect(screen.getByText("Name")).toBeDefined();
  });

  it("aplica role", () => {
    render(<TestimonialCard quote="Q" name="N" role="Cargo" />);
    expect(screen.getByText("Cargo")).toBeDefined();
  });

  it("renderiza avatar com initials", () => {
    render(<TestimonialCard quote="Q" name="N" initials="AB" />);
    expect(screen.getByText("AB")).toBeDefined();
  });

  it("exibe avaliação de 5 estrelas", () => {
    render(<TestimonialCard quote="Q" name="N" />);
    expect(screen.getByLabelText("5 de 5 estrelas")).toBeDefined();
  });
});
