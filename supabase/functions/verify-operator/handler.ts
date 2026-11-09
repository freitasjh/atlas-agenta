// Handler da Edge Function `verify-operator` — único caminho de prova de operador.
// POST com `Authorization: Bearer <jwt>`; responde 200 {is_operator, aal, user_id}
// ou 403 fail-closed {is_operator:false}. Erro/timeout também nega. Sem PII em log.
// verify_jwt=true (config.toml): o GoTrue valida o JWT antes; aqui revalidamos via
// Auth API + factors AAL2 por request, sem confiar em claim nem em cache client.
//
// Anti-enumeração server-side: não-operador, sem factor verificado e erro interno
// respondem o MESMO corpo `{ is_operator: false }` com 403 — o cliente nunca
// distingue qual etapa negou. Só a ausência de token é 401 (não autenticado).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS, jsonResponse, ApiError, errorResponse } from "../_shared/http.ts";
import { verifyInternalOperator } from "../_shared/internal-operator.ts";

const corsHeaders: Record<string, string> = {
  ...CORS_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ is_operator: false }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type VerifyOperatorOptions = {
  createService: () => SupabaseClient;
};

export function createVerifyOperatorHandler(
  options: VerifyOperatorOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ is_operator: false }, 403);
    }
    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return forbiddenResponse();
    }
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ is_operator: false }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const result = await verifyInternalOperator(service, token);
      return jsonResponse({ is_operator: result.isOperator, aal: result.aal, user_id: result.userId }, 200);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return new Response(JSON.stringify({ is_operator: false }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return forbiddenResponse();
    }
  };
}
