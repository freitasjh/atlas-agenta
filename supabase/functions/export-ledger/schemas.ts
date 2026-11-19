import { z } from "npm:zod@3.23.8";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");

/**
 * Corpo do export. As bordas absolutas (`ini`/`fim`) vêm do cliente já
 * derivadas do fuso do tenant (`tenantRangeUtc`), como no DRE — a Edge não
 * reinterpreta fuso. `periodo_ini`/`periodo_fim` são os rótulos do período.
 */
export const requestSchema = z
  .object({
    periodo_ini: isoDate,
    periodo_fim: isoDate,
    ini: z.string().min(1).max(40),
    fim: z.string().min(1).max(40),
    formato: z.enum(["csv", "ofx", "sped"]),
    escopo: z.enum(["receber", "pagar", "fiscal"]),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
