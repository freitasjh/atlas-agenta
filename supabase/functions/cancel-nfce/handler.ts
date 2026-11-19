import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { resolveIdentity } from "../_shared/identity.ts";
import {
  ApiError,
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  logEvent,
  messageForCode,
} from "../_shared/http.ts";
import { requestSchema } from "./schemas.ts";

export type HandlerOptions = { createService: () => SupabaseClient };

/**
 * Cancelamento e carta de correção (ADR-03 RF-04): admin-only. Cancelamento
 * exige motivo, valida o estado (`autorizada` → `cancelada`), preserva
 * XML/DANFE (nunca apaga `xml`/`danfe_url`) e grava evento com `created_by`.
 * Carta anexa evento `carta` sem mudar o status. Idempotente: documento já
 * `cancelada` devolve a linha com `replayed: true`.
 */
export function createHandler(options: HandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") {
      return jsonResponse(
        { code: "METHOD_NOT_ALLOWED", message: messageForCode("METHOD_NOT_ALLOWED") },
        405,
      );
    }

    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return jsonResponse({ code: "INTERNAL", message: messageForCode("INTERNAL") }, 500);
    }

    try {
      const identity = await resolveIdentity(req, service, ["admin"]);

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");
      const body = parsed.data;

      const { data: documento, error: documentoError } = await service
        .from("fiscal_documents")
        .select("id, status, xml, danfe_url")
        .eq("tenant_id", identity.tenantId)
        .eq("id", body.fiscal_document_id)
        .maybeSingle();
      if (documentoError) throw new ApiError(500, "INTERNAL");
      if (!documento) throw new ApiError(404, "FISCAL_NOT_FOUND");

      if (body.acao === "carta") {
        if (documento.status !== "autorizada") throw new ApiError(409, "FISCAL_INVALID_STATE");
        const { error: eventoError } = await service.from("fiscal_events").insert({
          tenant_id: identity.tenantId,
          fiscal_document_id: body.fiscal_document_id,
          tipo: "carta",
          motivo: body.motivo,
          payload: {},
          created_by: identity.userId,
        });
        if (eventoError) throw new ApiError(500, "INTERNAL");
        logEvent("nfce_carta", {
          tenant_id: identity.tenantId,
          actor_id: identity.userId,
          fiscal_document_id: body.fiscal_document_id,
          reason_length: body.motivo.length,
        });
        return jsonResponse(
          { document_id: body.fiscal_document_id, acao: "carta", replayed: false },
          200,
        );
      }

      if (documento.status === "cancelada") {
        return jsonResponse(
          { document_id: body.fiscal_document_id, acao: "cancelamento", replayed: true },
          200,
        );
      }
      if (documento.status !== "autorizada") throw new ApiError(409, "FISCAL_INVALID_STATE");

      const { error: updateError } = await service
        .from("fiscal_documents")
        .update({ status: "cancelada" })
        .eq("tenant_id", identity.tenantId)
        .eq("id", body.fiscal_document_id);
      if (updateError) throw new ApiError(500, "INTERNAL");

      const { error: eventoError } = await service.from("fiscal_events").insert({
        tenant_id: identity.tenantId,
        fiscal_document_id: body.fiscal_document_id,
        tipo: "cancelamento",
        motivo: body.motivo,
        payload: { xml_preservado: documento.xml !== null },
        created_by: identity.userId,
      });
      if (eventoError) throw new ApiError(500, "INTERNAL");

      logEvent("nfce_cancelada", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        fiscal_document_id: body.fiscal_document_id,
        reason_length: body.motivo.length,
      });
      return jsonResponse(
        { document_id: body.fiscal_document_id, acao: "cancelamento", replayed: false },
        200,
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}
