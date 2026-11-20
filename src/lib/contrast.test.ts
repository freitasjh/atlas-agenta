import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  contrast,
  getToken,
  readOklchTokens,
  type TokenSet,
} from "@/test/oklch-contrast";

/**
 * Medição de contraste WCAG dos tokens de cor de `src/tokens-shadcn.css` (ADR-01).
 * Lê os valores oklch dos blocos `:root` (tema claro) e `.dark` (tema escuro),
 * converte para sRGB linear e calcula a razão de contraste. Tokens com alpha
 * são compostos sobre o fundo antes da medição.
 * Limites: texto ≥ 4,5:1 (WCAG 1.4.3); não textual ≥ 3:1 (WCAG 1.4.11).
 *
 * Fonte do algoritmo de conversão: CSS Color 4 §19 —
 * https://www.w3.org/TR/css-color-4/ (consulta 2026-11-20).
 * Fonte dos limiares: WCAG 2.1 — https://www.w3.org/TR/WCAG21/ (consulta 2026-11-20).
 */

const TOKENS_PATH = fileURLToPath(
  new URL("../tokens-shadcn.css", import.meta.url),
);
const { light, dark } = readOklchTokens(readFileSync(TOKENS_PATH, "utf8"));

const TEXT_MIN_RATIO = 4.5;
const NON_TEXT_MIN_RATIO = 3;

/**
 * Pares de texto com contraste ≥ 4,5:1 no template. `--muted-foreground` é
 * medido sobre `--background` (fundo real das legendas): sobre `--muted`
 * o template shadcn neutral fica em 4,34:1.
 */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "card"],
  ["muted-foreground", "background"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
];

/** Pares usados como indicação visual (≥ 3:1) no template. */
const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["destructive", "card"],
  ["primary", "card"],
];

const themes: ReadonlyArray<readonly [string, TokenSet]> = [
  ["claro", light],
  ["escuro", dark],
];

for (const [theme, tokens] of themes) {
  describe(`contraste do tema ${theme}`, () => {
    it.each(TEXT_PAIRS)(
      "texto --%s sobre --%s atinge 4,5:1",
      (foreground, background) => {
        const ratio = contrast(
          getToken(tokens, foreground),
          getToken(tokens, background),
        );
        expect(
          ratio,
          `--${foreground} sobre --${background} (${theme}): ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
      },
    );

    it.each(NON_TEXT_PAIRS)(
      "componente --%s sobre --%s atinge 3:1",
      (component, background) => {
        const ratio = contrast(
          getToken(tokens, component),
          getToken(tokens, background),
        );
        expect(
          ratio,
          `--${component} sobre --${background} (${theme}): ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(NON_TEXT_MIN_RATIO);
      },
    );
  });
}
