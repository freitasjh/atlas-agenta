// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerCrmFilters } from "@/app/clientes/CustomerCrmFilters";

afterEach(cleanup);

describe("CustomerCrmFilters — filtros por tag/segmento/no-show (RF-29)", () => {
  it("renderiza controle de tag com valor selecionado", () => {
    render(
      <CustomerCrmFilters
        value={{ tag: "vip", segment: "", minNoShow: 0 }}
        onChange={() => undefined}
        tags={["vip", "inativo"]}
      />,
    );
    expect(screen.getByRole("combobox", { name: /tag/i })).toBeTruthy();
  });

  it("altera segmento e no-show mínimo", () => {
    const onChange = vi.fn();
    render(
      <CustomerCrmFilters
        value={{ tag: "", segment: "", minNoShow: 0 }}
        onChange={onChange}
        tags={["vip"]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/segmento/i), { target: { value: "recorrente" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ segment: "recorrente" }));
    fireEvent.change(screen.getByLabelText(/no-show mínimo/i), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minNoShow: 2 }));
  });

  it("limpar restaura filtros vazios", () => {
    const onChange = vi.fn();
    render(
      <CustomerCrmFilters
        value={{ tag: "vip", segment: "recorrente", minNoShow: 2 }}
        onChange={onChange}
        tags={["vip"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /limpar filtros/i }));
    expect(onChange).toHaveBeenCalledWith({ tag: "", segment: "", minNoShow: 0 });
  });
});
