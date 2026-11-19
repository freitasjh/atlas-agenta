// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  formatLevelsText,
  formToProgramPayload,
  parseLevelsText,
} from "@/app/fidelidade/model";

describe("fidelidade model — níveis", () => {
  it("parseia Nome:pontos um por linha e ordena", () => {
    expect(parseLevelsText("Ouro:500\nPrata:100")).toEqual([
      { name: "Prata", min_points: 100 },
      { name: "Ouro", min_points: 500 },
    ]);
  });

  it("vazio vira null (sem níveis)", () => {
    expect(parseLevelsText("")).toBeNull();
    expect(parseLevelsText("   ")).toBeNull();
    expect(parseLevelsText(undefined)).toBeNull();
  });

  it("ignora linhas inválidas sem derrubar as válidas", () => {
    expect(parseLevelsText("Ouro:500\nlixo\n:10\nPrata:abc")).toEqual([
      { name: "Ouro", min_points: 500 },
    ]);
  });

  it("serializa níveis para o editor", () => {
    expect(formatLevelsText([{ name: "Ouro", min_points: 500 }])).toBe("Ouro:500");
    expect(formatLevelsText(null)).toBe("");
    expect(formatLevelsText([])).toBe("");
  });

  it("payload do programa carrega levels (nada descartado)", () => {
    const payload = formToProgramPayload({
      active: true,
      points_per_real: 1,
      rounding: "floor",
      expiry_days: "",
      levels_text: "Prata:100",
    });
    expect(payload).toMatchObject({
      levels: [{ name: "Prata", min_points: 100 }],
    });
  });
});
