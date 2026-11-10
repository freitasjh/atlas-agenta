// Handler da Edge Function `verify-operator` — status de operador p/ roteamento.
// POST com `Authorization: Bearer <jwt>`; operador ativo responde 200
// {is_operator:true, aal, user_id, enrolled_factors}; não-operador e erro
// interno respondem o MESMO corpo `{ is_operator: false }` com 403 — o cliente
// nunca distingue qual etapa negou. Só a ausência de token/JWT inválido é 401.
// Sem PII em log. verify_jwt=true (config.toml): o GoTrue valida o JWT antes;
// aqui revalidamos via Auth API + factors AAL2 por request, sem confiar em
// claim nem em cache client.
//
// Decisão enroll-rota: este handler RELATA (200) o `aal` da sessão + a
// contagem de factors verificados p/ o cliente rotear enroll×mfa. NÃO autoriza:
// a prova real segue em `verifyInternalOperator` (usado pelas Edges de dados,
// fail-closed) e no guard do cliente (só aal2+factor libera área interna).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS, jsonResponse } from "../_shared/http.ts";
import {
  isActiveInternalOperator,
  readJwtAal,
  readVerifiedFactorsCount,
} from "../_shared/internal-operator.ts";

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
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user) {
        return new Response(JSON.stringify({ is_operator: false }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userId = data.user.id;
      let operator = false;
      try {
        operator = await isActiveInternalOperator(service, userId);
      } catch {
        return forbiddenResponse();
      }
      if (!operator) {
        console.warn("verify-operator: deny non-operator");
        return forbiddenResponse();
      }
      // Operador ativo: relata aal da sessão + factors enrolados (200). O
      // guard decide: aal2+factor → área; aal1+0 factors → enroll; aal1+factors
      // → mfa. Leitura de factors falha fechado (403 idêntico).
      let enrolled = 0;
      try {
        enrolled = await readVerifiedFactorsCount(service, userId);
      } catch {
        return forbiddenResponse();
      }
      const aal = readJwtAal(token) ?? "aal1";
      return jsonResponse(
        { is_operator: true, aal, user_id: userId, enrolled_factors: enrolled },
        200,
      );
    } catch {
      return forbiddenResponse();
    }
  };
}
