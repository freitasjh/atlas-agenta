import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  contrast,
  getToken,
  readOklchTokens,
} from "@/test/oklch-contrast";

const TOKENS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "tokens-shadcn.css",
);
const { light, dark } = readOklchTokens(readFileSync(TOKENS_PATH, "utf8"));

describe("contraste dos tokens shadcn (oklch)", () => {
  it("primary-foreground/primary (claro) >= 4.5", () => {
    const ratio = contrast(
      getToken(light, "primary-foreground"),
      getToken(light, "primary"),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("primary/card (claro) >= 3", () => {
    const ratio = contrast(getToken(light, "primary"), getToken(light, "card"));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it("ring/background (claro) mantém o contraste do template neutral-400", () => {
    // Caracterização: o template usa --ring = neutral-400 (0.708) sobre
    // neutral-100 (0.985) => 2.48:1. Não é limiar WCAG; registra o valor real.
    const ratio = contrast(getToken(light, "ring"), getToken(light, "background"));
    expect(ratio).toBeGreaterThanOrEqual(2.4);
  });

  it("input/card (claro) mantém o contraste sutil do template neutral-300", () => {
    // Caracterização: --input = neutral-300 (0.922) sobre card branco => 1.26:1.
    // Bordas sutis são decisão visual do template (DESIGN.md §2.1).
    const ratio = contrast(getToken(light, "input"), getToken(light, "card"));
    expect(ratio).toBeGreaterThanOrEqual(1.2);
  });

  it("input/card (escuro) mantém a composição sutil do alpha do template", () => {
    // Caracterização: --input = rgb(255 255 255 / 15%) sobre card escuro.
    // Compositing 1 §5.1 opera em sRGB codificado: 0,15×1 + 0,85×0,0905 ≈
    // 0,227 codificado => 1,57:1. Compor em linear daria 3,54:1 (valor
    // incorreto). Bordas sutis são decisão visual do template (DESIGN.md §2.1).
    const ratio = contrast(getToken(dark, "input"), getToken(dark, "card"));
    expect(ratio).toBeGreaterThanOrEqual(1.5);
  });

  it("ring/background (escuro) >= 3", () => {
    const ratio = contrast(getToken(dark, "ring"), getToken(dark, "background"));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

/** Estados de status (ADR-06): par --status-{base} (fundo) / --status-{base}-fg (texto). */
const STATUS_BASES = [
  "pendente",
  "confirmado",
  "em-atendimento",
  "concluido",
  "cancelado",
  "nao-compareceu",
  "sub-cancelado",
] as const;

describe("contraste dos tokens de status (ADR-06)", () => {
  for (const [themeName, theme] of [
    ["claro", light],
    ["escuro", dark],
  ] as const) {
    describe(themeName, () => {
      it.each(STATUS_BASES)("status-%s: fg sobre fundo >= 4.5:1", (base) => {
        const ratio = contrast(
          getToken(theme, `status-${base}-fg`),
          getToken(theme, `status-${base}`),
        );
        expect(
          ratio,
          `--status-${base}-fg sobre --status-${base} (${themeName}): ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
