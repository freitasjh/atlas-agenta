import { z } from "npm:zod@3.23.8";

const motivoSchema = z
  .string()
  .trim()
  .min(15, "motivo deve ter ao menos 15 caracteres")
  .max(1000);

/**
 * Cancelamento ou carta de correção (ADR-03 RF-04): `acao` discrimina; motivo
 * auditável obrigatório nas duas; cancelamento só de `autorizada`; carta só de
 * `autorizada` e nunca muda o status (só anexa evento).
 */
export const requestSchema = z
  .object({
    fiscal_document_id: z.string().uuid(),
    acao: z.enum(["cancelamento", "carta"]).optional().default("cancelamento"),
    motivo: motivoSchema,
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
