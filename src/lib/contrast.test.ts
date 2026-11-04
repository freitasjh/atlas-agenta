import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
/**
 * Medição de contraste WCAG dos tokens de cor de `src/index.css` (ADR-01).
 * Lê os valores HSL dos blocos `:root` (tema claro) e `.dark` (tema escuro),
 * converte para sRGB, calcula a luminância relativa e a razão de contraste.
 * Limites: texto ≥ 4,5:1 (WCAG 1.4.3); não textual ≥ 3:1 (WCAG 1.4.11).
 * Mede os tokens, não o DOM renderizado (a medição no DOM fica na ADR-18).
 */

type Hsl = { h: number; s: number; l: number };
type Tokens = Record<string, Hsl>;

const css = readFileSync(
  fileURLToPath(new URL("../index.css", import.meta.url)),
  "utf8",
);

const TEXT_MIN_RATIO = 4.5;
const NON_TEXT_MIN_RATIO = 3;

// Pares de texto (fundo ou fundo de componente) e de componentes não textuais.
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
];

const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ring", "background"],
  ["input", "card"],
];

function readBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) {
    throw new Error(`Bloco ${selector} não encontrado em src/index.css`);
  }
  return match[1];
}

function parseTokens(block: string): Tokens {
  const tokens: Tokens = {};
  const declaration =
    /--([\w-]+):\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*;/g;
  for (const match of block.matchAll(declaration)) {
    tokens[match[1]] = {
      h: Number(match[2]),
      s: Number(match[3]),
      l: Number(match[4]),
    };
  }
  return tokens;
}

function getToken(tokens: Tokens, name: string): Hsl {
  const token = tokens[name];
  if (!token) {
    throw new Error(`Token --${name} não encontrado em src/index.css`);
  }
  return token;
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const sectors: ReadonlyArray<readonly [number, number, number]> = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r1, g1, b1] = sectors[Math.min(Math.floor(hue), 5)];
  const m = lightness - chroma / 2;
  return [r1 + m, g1 + m, b1 + m];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number): number =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: Hsl, b: Hsl): number {
  const lumA = relativeLuminance(hslToRgb(a));
  const lumB = relativeLuminance(hslToRgb(b));
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const themes: ReadonlyArray<readonly [string, Tokens]> = [
  ["claro", parseTokens(readBlock(":root"))],
  ["escuro", parseTokens(readBlock(".dark"))],
];

for (const [theme, tokens] of themes) {
  describe(`contraste do tema ${theme}`, () => {
    it.each(TEXT_PAIRS)(
      "texto --%s sobre --%s atinge 4,5:1",
      (foreground, background) => {
        const ratio = contrastRatio(
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
        const ratio = contrastRatio(
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
