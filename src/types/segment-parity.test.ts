import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BUSINESS_SEGMENTS } from "@/types/domain";

/**
 * Paridade do enum de `segment` entre cliente e servidor (ADR-03).
 *
 * O formulário de cadastro envia `body.segment` para a Edge Function
 * `signup-tenant`, que o valida com `z.enum(SEGMENTS)` (ADR-02). Se as duas
 * listas divergirem, o cliente oferece um ramo que o servidor recusa (ou deixa
 * de oferecer um ramo válido) — defeito silencioso, sem erro de compilação,
 * porque o enum do servidor vive num módulo Deno.
 *
 * O `schemas.ts` da Edge Function não é importável aqui: ele importa
 * `npm:zod@3.23.8`, especificador que nem o Vite/Vitest nem o `tsc` resolvem.
 * Por isso a leitura é textual — o teste continua provando a paridade dos
 * literais e falha se o array do servidor mudar.
 */

const SERVER_SCHEMAS = new URL(
  "../../supabase/functions/signup-tenant/schemas.ts",
  import.meta.url,
);

/** Lê o array literal `SEGMENTS` de `signup-tenant/schemas.ts`. */
function readServerSchemas(): string {
  return readFileSync(SERVER_SCHEMAS, "utf8");
}

function readServerSegments(source: string): string[] {
  const declaration = /export const SEGMENTS = \[([^\]]*)\] as const;/.exec(source);
  if (!declaration) {
    throw new Error("SEGMENTS não encontrado em signup-tenant/schemas.ts");
  }

  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("segment — paridade cliente × Edge signup-tenant (ADR-03)", () => {
  it("BUSINESS_SEGMENTS e SEGMENTS do servidor têm exatamente os mesmos valores", () => {
    const source = readServerSchemas();

    expect(readServerSegments(source)).toEqual([...BUSINESS_SEGMENTS]);
  });

  it("o schema do servidor valida o corpo com z.enum(SEGMENTS)", () => {
    // Sem isso a extração acima poderia passar com um array morto no arquivo.
    expect(readServerSchemas()).toContain("z.enum(SEGMENTS)");
  });

  it("a tripla é a canônica do check SQL `tenants_segment_check`", () => {
    expect([...BUSINESS_SEGMENTS]).toEqual(["barbearia", "clinica", "salao"]);
  });
});
