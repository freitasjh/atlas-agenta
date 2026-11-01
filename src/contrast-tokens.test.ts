import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "index.css");
const CSS = readFileSync(CSS_PATH, "utf8");

function extractVars(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "\\s*\\{([\\s\\S]*?)\\}", "m"));
  if (!match) throw new Error(`bloco ${selector} não encontrado em index.css`);
  const vars: Record<string, string> = {};
  for (const m of match[1].matchAll(/--([a-z0-9-]+):\s*([0-9.]+\s+[0-9.]+%\s+[0-9.]+%)\s*;/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function tokenRgb(vars: Record<string, string>, name: string): [number, number, number] {
  const value = vars[name];
  if (!value) throw new Error(`token --${name} não encontrado`);
  const [h, s, l] = value.split(/\s+/);
  return hslToRgb(Number(h), Number(s.replace("%", "")), Number(l.replace("%", "")));
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("contrast tokens (ADR-16 / P-09)", () => {
  const light = extractVars(CSS, ":root");
  const dark = extractVars(CSS, ".dark");

  it("primary-foreground/primary (claro) >= 4.5", () => {
    const ratio = contrast(tokenRgb(light, "primary-foreground"), tokenRgb(light, "primary"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("primary/card (claro) >= 3", () => {
    const ratio = contrast(tokenRgb(light, "primary"), tokenRgb(light, "card"));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it("ring/background (claro) >= 3", () => {
    const ratio = contrast(tokenRgb(light, "ring"), tokenRgb(light, "background"));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it("input/card (claro) >= 3", () => {
    const ratio = contrast(tokenRgb(light, "input"), tokenRgb(light, "card"));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it("input/card (escuro) >= 3", () => {
    const ratio = contrast(tokenRgb(dark, "input"), tokenRgb(dark, "card"));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});