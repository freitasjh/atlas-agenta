// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PeriodFilter } from "@/app/relatorios/PeriodFilter";

afterEach(() => cleanup());

describe("PeriodFilter ids (QA-ADR005-02)", () => {
  it("prefixos explícitos geram ids únicos por página", () => {
    const { container } = render(
      <>
        <PeriodFilter
          idPrefix="financeiro"
          preset="mes"
          start="2026-11-01"
          end="2026-11-30"
          onPresetChange={() => {}}
          onStartChange={() => {}}
          onEndChange={() => {}}
        />
        <PeriodFilter
          idPrefix="recebimentos"
          preset="mes"
          start="2026-11-01"
          end="2026-11-30"
          onPresetChange={() => {}}
          onStartChange={() => {}}
          onEndChange={() => {}}
        />
        <PeriodFilter
          idPrefix="comissoes"
          preset="mes"
          start="2026-11-01"
          end="2026-11-30"
          onPresetChange={() => {}}
          onStartChange={() => {}}
          onEndChange={() => {}}
        />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((el) =>
      el.getAttribute("id"),
    );
    expect(ids).toContain("financeiro-inicio");
    expect(ids).toContain("financeiro-fim");
    expect(ids).toContain("recebimentos-inicio");
    expect(ids).toContain("recebimentos-fim");
    expect(ids).toContain("comissoes-inicio");
    expect(ids).toContain("comissoes-fim");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sem prefixo, duas instâncias não colidem (useId)", () => {
    const { container } = render(
      <>
        <PeriodFilter
          preset="mes"
          start="2026-11-01"
          end="2026-11-30"
          onPresetChange={() => {}}
          onStartChange={() => {}}
          onEndChange={() => {}}
        />
        <PeriodFilter
          preset="mes"
          start="2026-11-01"
          end="2026-11-30"
          onPresetChange={() => {}}
          onStartChange={() => {}}
          onEndChange={() => {}}
        />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((el) =>
      el.getAttribute("id"),
    );
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
