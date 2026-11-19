import { z } from "npm:zod@3.23.8";

export const MAX_CONTENT_CHARS = 2_000_000;

export const requestSchema = z
  .object({
    account_id: z.string().uuid(),
    formato: z.enum(["ofx", "csv"]),
    nome_arquivo: z.string().trim().min(1).max(200),
    conteudo: z.string().min(1).max(MAX_CONTENT_CHARS),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
