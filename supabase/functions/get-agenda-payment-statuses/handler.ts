import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveIdentity } from "../_shared/identity.ts";
import {
  ApiError,
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  logEvent,
  mapRpcError,
  messageForCode,
} from "../_shared/http.ts";
import { requestSchema } from "./schemas.ts";

export type HandlerOptions = { createService: () => SupabaseClient };

const PAYMENT_ROLES = ["admin", "receptionist", "professional"] as const;

interface StatusRow {
  appointment_id: unknown;
  payment_status: unknown;
}

/**
 * Só o rótulo de estado financeiro de atendimentos que o ator já pode ver.
 * Nenhum valor, saldo, linha, QR ou histórico chega ao cliente (ADR-002, adendo).
 */
function toStatuses(rows: unknown): Array<{ appointment_id: string; payment_status: string }> {
  if (!Array.isArray(rows)) return [];
  const statuses: Array<{ appointment_id: string; payment_status: string }> = [];
  for (const row of rows as StatusRow[]) {
    if (typeof row?.appointment_id !== "string" || typeof row?.payment_status !== "string") continue;
    statuses.push({
      appointment_id: row.appointment_id,
      payment_status: row.payment_status,
    });
  }
  return statuses;
}

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
      const identity = await resolveIdentity(req, service, PAYMENT_ROLES);

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");
      const ids = parsed.data.appointment_ids;

      let professionalId: string | null = null;
      if (identity.role === "professional") {
        const { data: professional, error: professionalError } = await service
          .from("professionals")
          .select("id")
          .eq("tenant_id", identity.tenantId)
          .eq("profile_id", identity.userId)
          .maybeSingle();
        if (professionalError) throw new ApiError(500, "INTERNAL");
        if (!professional?.id) throw new ApiError(403, "PROFESSIONAL_NOT_OWNER");
        professionalId = professional.id as string;
      }

      // O SQL recorta por `p_professional_id` e só devolve os atendimentos do próprio ator:
      // atendimento alheio e atendimento inexistente têm a mesma resposta (200, sem linha).
      const { data, error } = await service.rpc("agenda_payment_statuses", {
        p_tenant_id: identity.tenantId,
        p_appointment_ids: ids,
        p_professional_id: professionalId,
        p_actor_id: identity.userId,
      });
      if (error) throw mapRpcError(error);

      logEvent("agenda_payment_statuses_read", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        status: "ok",
      });

      return jsonResponse({ statuses: toStatuses(data) }, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
