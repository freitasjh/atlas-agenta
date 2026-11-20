/**
 * Leitura e conversão de tokens oklch para cálculo de contraste WCAG.
 *
 * Algoritmo (OKLCH → OKLab → XYZ D65 → sRGB linear) segundo a especificação:
 * CSS Color Module Level 4, §7.1, §10.11 e §19 "Sample code for Color Conversions" —
 * https://www.w3.org/TR/css-color-4/ (consulta 2026-11-20).
 * Composição alpha: Compositing and Blending Level 1 §5.1 "Simple alpha
 * compositing" — https://www.w3.org/TR/compositing-1/ (consulta 2026-11-20),
 * aplicada a componentes sRGB codificados (CSS Color 4 §10.13).
 * Luminância/razão de contraste: WCAG 2.1 §1.4.3 / dfn-relative-luminance —
 * https://www.w3.org/TR/WCAG21/ (consulta 2026-11-20).
 *
 * Uso exclusivo em testes: mede os tokens publicados, não o DOM renderizado.
 */

export type Oklch = {
  l: number;
  c: number;
  h: number;
  alpha: number;
};

export type TokenSet = Record<string, Oklch>;

function parseNumber(raw: string, label: string): number {
  const value = raw.trim().endsWith("%")
    ? Number.parseFloat(raw) / 100
    : Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Componente ${label} inválido em oklch: "${raw}"`);
  }
  return value;
}

export function parseOklch(value: string): Oklch {
  const match = value
    .trim()
    .match(
      /^oklch\(\s*([^/\s]+)\s+([^/\s]+)\s+([^/\s]+)(?:\s*\/\s*([^)]+))?\s*\)$/,
    );
  if (!match) {
    throw new Error(`Valor oklch inválido: "${value}"`);
  }
  const hueToken = match[3] ?? "0";
  const hue = hueToken.endsWith("deg")
    ? Number.parseFloat(hueToken)
    : Number.parseFloat(hueToken);
  if (!Number.isFinite(hue)) {
    throw new Error(`Matiz inválido em oklch: "${hueToken}"`);
  }
  return {
    l: parseNumber(match[1] ?? "0", "L"),
    c: parseNumber(match[2] ?? "0", "C"),
    h: hue,
    alpha: match[4] ? parseNumber(match[4], "alpha") : 1,
  };
}

/** Lê os blocos `:root` e `.dark` de um arquivo de tokens oklch. */
export function readOklchTokens(css: string): { light: TokenSet; dark: TokenSet } {
  function block(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
    if (!match) {
      throw new Error(`Bloco ${selector} não encontrado no arquivo de tokens`);
    }
    return match[1] ?? "";
  }

  function parseBlock(source: string): TokenSet {
    const tokens: TokenSet = {};
    for (const match of source.matchAll(
      /--([a-z0-9-]+):\s*(oklch\([^)]*\))\s*;/g,
    )) {
      const name = match[1];
      if (name) tokens[name] = parseOklch(match[2] ?? "");
    }
    return tokens;
  }

  return { light: parseBlock(block(":root")), dark: parseBlock(block(".dark")) };
}

export function getToken(tokens: TokenSet, name: string): Oklch {
  const token = tokens[name];
  if (!token) throw new Error(`Token --${name} não encontrado`);
  return token;
}

/** Converte oklch para RGB linear sRGB (sem gamma), conforme CSS Color 4. */
export function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const lms = [
    l + 0.3963377773761749 * a + 0.2158037573099136 * b,
    l - 0.1055613458156586 * a - 0.0638541728258133 * b,
    l - 0.0894841775298119 * a - 1.2914855480194092 * b,
  ].map((value) => value ** 3);

  const [lmsL, lmsM, lmsS] = lms as [number, number, number];
  const xyz: [number, number, number] = [
    1.2268798758459243 * lmsL - 0.5578149944602171 * lmsM + 0.2813910456659647 * lmsS,
    -0.0405757452148008 * lmsL + 1.112286803280317 * lmsM - 0.0717110580655164 * lmsS,
    -0.0763729366746601 * lmsL - 0.4214933324022432 * lmsM + 1.5869240198367816 * lmsS,
  ];
  const [x, y, z] = xyz;
  return [
    (12831 / 3959) * x - (329 / 214) * y - (1974 / 3959) * z,
    (-851781 / 878810) * x + (1648619 / 878810) * y + (36519 / 878810) * z,
    (705 / 12673) * x - (2585 / 12673) * y + (705 / 667) * z,
  ];
}

function clampChannel(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Transfer function sRGB linear → sRGB codificado (CSS Color 4 §19 `gam_sRGB`).
 * Extensão de sinal para valores negativos preserva a direção do sinal.
 */
export function linearToSrgb(linear: [number, number, number]): [number, number, number] {
  return linear.map((val) => {
    const sign = val < 0 ? -1 : 1;
    const abs = Math.abs(val);
    return abs > 0.0031308
      ? sign * (1.055 * abs ** (1 / 2.4) - 0.055)
      : 12.92 * val;
  }) as [number, number, number];
}

/** Transfer function sRGB codificado → sRGB linear (CSS Color 4 §19 `lin_sRGB`). */
export function srgbToLinear(encoded: [number, number, number]): [number, number, number] {
  return encoded.map((val) => {
    const sign = val < 0 ? -1 : 1;
    const abs = Math.abs(val);
    return abs <= 0.04045 ? val / 12.92 : sign * ((abs + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

export function relativeLuminance(rgb: [number, number, number]): number {
  return (
    0.2126 * clampChannel(rgb[0]) +
    0.7152 * clampChannel(rgb[1]) +
    0.0722 * clampChannel(rgb[2])
  );
}

/**
 * Compoe `foreground` (com alpha) sobre `background` e mede a razão WCAG.
 *
 * `source-over` (Compositing 1 §5.1) opera nos valores de cor armazenados.
 * Para CSS esses valores são sRGB **codificado** (gamma), não linear: converter
 * para linear antes de compor superestima o contraste de tokens com alpha
 * (ex.: `--input` dark = branco/15% sobre `--card` dark: 1,57:1 correto vs
 * 3,54:1 se composto em linear). Compoe em codificado e lineariza de volta
 * somente para calcular a luminância relativa.
 */
export function contrast(foreground: Oklch, background: Oklch): number {
  const bgLinear = oklchToLinearRgb(background);
  const bgEncoded = linearToSrgb(bgLinear);
  const fgEncoded = linearToSrgb(oklchToLinearRgb(foreground));
  const alpha = clampChannel(foreground.alpha);
  const composedEncoded: [number, number, number] = [
    fgEncoded[0] * alpha + bgEncoded[0] * (1 - alpha),
    fgEncoded[1] * alpha + bgEncoded[1] * (1 - alpha),
    fgEncoded[2] * alpha + bgEncoded[2] * (1 - alpha),
  ];
  const a = relativeLuminance(srgbToLinear(composedEncoded));
  const b = relativeLuminance(bgLinear);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
