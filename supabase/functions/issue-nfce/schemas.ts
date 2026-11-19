import { z } from "npm:zod@3.23.8";

import { DestinatarioDocumentoSchema, FISCAL_ORIGIN_TYPES } from "../_shared/fiscal.ts";

export const requestSchema = z
  .object({
    origem_tipo: z.enum(FISCAL_ORIGIN_TYPES),
    origem_id: z.string().uuid(),
    valor_cents: z.number().int().positive(),
    destinatario_documento: DestinatarioDocumentoSchema.optional(),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
