// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BentoCard } from "@/components/marketing/bento-card";

afterEach(cleanup);

describe("BentoCard", () => {
  it("renderiza sem crash", () => {
    render(<BentoCard title="Titulo" />);
    expect(screen.getByText("Titulo")).toBeDefined();
  });

  it("aplica description", () => {
    render(<BentoCard title="T" description="Desc" />);
    expect(screen.getByText("Desc")).toBeDefined();
  });

  it("renderiza icon", () => {
    render(<BentoCard title="T" icon={<span aria-label="icone">I</span>} />);
    expect(screen.getByLabelText("icone")).toBeDefined();
  });

  it("renderiza children", () => {
    render(<BentoCard title="T"><span>child</span></BentoCard>);
    expect(screen.getByText("child")).toBeDefined();
  });

  it("aplica colSpan", () => {
    const { container } = render(<BentoCard title="T" colSpan={2} />);
    expect((container.firstChild as HTMLElement).className).toContain("md:col-span-2");
  });
});
