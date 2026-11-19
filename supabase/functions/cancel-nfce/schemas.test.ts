import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

const DOC = "22222222-2222-4222-8222-222222222222";

Deno.test("cancel aceita motivo longo e rejeita curto ou ausente", () => {
  strictEqual(
    requestSchema.safeParse({ fiscal_document_id: DOC, motivo: "Erro de digitação no valor do item" }).success,
    true,
  );
  strictEqual(
    requestSchema.safeParse({ fiscal_document_id: DOC, acao: "carta", motivo: "Correção do endereço do destinatário fiscal" }).success,
    true,
  );
  strictEqual(requestSchema.safeParse({ fiscal_document_id: DOC, motivo: "curto" }).success, false);
  strictEqual(requestSchema.safeParse({ fiscal_document_id: DOC }).success, false);
  strictEqual(
    requestSchema.safeParse({ fiscal_document_id: DOC, motivo: "Erro de digitação no valor", tenant_id: "t1" }).success,
    false,
  );
});
