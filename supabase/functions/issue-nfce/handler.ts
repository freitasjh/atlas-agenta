import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { resolveIdentity } from "../_shared/identity.ts";
import { createStubFiscalProvider } from "../_shared/fiscal.ts";
import {
  ApiError,
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  logEvent,
  messageForCode,
} from "../_shared/http.ts";
import { requestSchema } from "./schemas.ts";

export type HandlerOptions = {
  createService: () => SupabaseClient;
  /** Injetável em teste; produção usa o stub auditado (ADR-03). */
  provider?: ReturnType<typeof createStubFiscalProvider>;
};

type FiscalRow = {
  id: string;
  origem_tipo: string;
  origem_id: string;
  numero: string | null;
  serie: string | null;
  chave_acesso: string | null;
  status: string;
  valor_cents: number;
  xml: string | null;
  danfe_url: string | null;
  created_at: string;
  authorized_at: string | null;
};

/**
 * Emissão de NFCe (ADR-03 RF-02/RF-03/RF-40): admin-only, idempotente por
 * origem (1 linha por (tenant, origem_tipo, origem_id); replay devolve a mesma
 * linha com `replayed: true`). Emissão nunca toca `appointment_payments`
 * (sem recálculo de receita — `valor_cents` é snapshot da origem).
 */
export function createHandler(options: HandlerOptions) {
  const provider = options.provider ?? createStubFiscalProvider();
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

      // Origem `appointment`: confere que o atendimento é do tenant (sem isso,
      // qualquer uuid válido viraria documento). `sale` ainda não tem tabela
      // (ADR futura) — passa com o vínculo só pela origem idempotente.
      if (body.origem_tipo === "appointment") {
        const { data: appointment, error: appointmentError } = await service
          .from("appointments")
          .select("id")
          .eq("tenant_id", identity.tenantId)
          .eq("id", body.origem_id)
          .maybeSingle();
        if (appointmentError) throw new ApiError(500, "INTERNAL");
        if (!appointment) throw new ApiError(404, "FISCAL_ORIGIN_NOT_FOUND");
      }

      // Replay idempotente: mesma origem → mesma linha, sem reautorizar e sem
      // tocar no ledger (efeito único, PRD RF-40).
      const { data: existente, error: existenteError } = await service
        .from("fiscal_documents")
        .select(
          "id, origem_tipo, origem_id, numero, serie, chave_acesso, status, valor_cents, xml, danfe_url, created_at, authorized_at",
        )
        .eq("tenant_id", identity.tenantId)
        .eq("origem_tipo", body.origem_tipo)
        .eq("origem_id", body.origem_id)
        .maybeSingle();
      if (existenteError) throw new ApiError(500, "INTERNAL");
      if (existente) {
        return jsonResponse(
          { document: existente as FiscalRow, replayed: true },
          200,
        );
      }

      const autorizacao = await provider.authorize({
        tenantId: identity.tenantId,
        origemTipo: body.origem_tipo,
        origemId: body.origem_id,
        valorCents: body.valor_cents,
      });

      const { data: inserido, error: insertError } = await service
        .from("fiscal_documents")
        .insert({
          tenant_id: identity.tenantId,
          origem_tipo: body.origem_tipo,
          origem_id: body.origem_id,
          numero: autorizacao.numero,
          serie: autorizacao.serie,
          chave_acesso: autorizacao.chave_acesso,
          status: autorizacao.status,
          valor_cents: body.valor_cents,
          xml: autorizacao.xml,
          authorized_at: autorizacao.status === "autorizada" ? new Date().toISOString() : null,
        })
        .select(
          "id, origem_tipo, origem_id, numero, serie, chave_acesso, status, valor_cents, xml, danfe_url, created_at, authorized_at",
        )
        .single();

      if (insertError || !inserido) {
        // Corrida: outro request gravou a origem entre o select e o insert
        // (unique 23505) → devolve a linha vencedora como replay, sem duplicar.
        const codigo = (insertError as { code?: string } | null)?.code;
        if (codigo === "23505") {
          const { data: vencedor, error: vencedorError } = await service
            .from("fiscal_documents")
            .select(
              "id, origem_tipo, origem_id, numero, serie, chave_acesso, status, valor_cents, xml, danfe_url, created_at, authorized_at",
            )
            .eq("tenant_id", identity.tenantId)
            .eq("origem_tipo", body.origem_tipo)
            .eq("origem_id", body.origem_id)
            .maybeSingle();
          if (vencedorError || !vencedor) throw new ApiError(500, "INTERNAL");
          return jsonResponse({ document: vencedor as FiscalRow, replayed: true }, 200);
        }
        throw new ApiError(500, "INTERNAL");
      }

      const doc = inserido as FiscalRow;
      const eventoTipo =
        autorizacao.status === "autorizada"
          ? "emissao"
          : autorizacao.status === "contingencia"
            ? "contingencia"
            : "rejeicao";
      const { error: eventoError } = await service.from("fiscal_events").insert({
        tenant_id: identity.tenantId,
        fiscal_document_id: doc.id,
        tipo: eventoTipo,
        motivo: autorizacao.motivo,
        payload: { origem_tipo: body.origem_tipo, origem_id: body.origem_id },
        created_by: identity.userId,
      });
      if (eventoError) throw new ApiError(500, "INTERNAL");

      logEvent("nfce_emitida", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        fiscal_document_id: doc.id,
        origem_tipo: body.origem_tipo,
        origem_id: body.origem_id,
        fiscal_status: autorizacao.status,
        amount_cents: body.valor_cents,
      });
      return jsonResponse({ document: doc, replayed: false }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
