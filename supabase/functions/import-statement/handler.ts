// Importação de extrato bancário (Fase 5 ADR-08; RF-22).
//
// Fronteira: o arquivo é parseado AQUI (OFX/CSV) e só a linha normalizada
// (`data`, `descricao`, `valor_cents`) chega ao banco pela RPC
// `reconciliation_statement_create` (grant só service_role). A RPC é atômica:
// arquivo inválido ⇒ 0 statements e 0 linhas.
//
// Idempotência (RF-22/RF-40): sha-256 do conteúdo normalizado + unique
// `(tenant_id, arquivo_hash)`. Reenviar o MESMO arquivo devolve o extrato
// existente com `replayed: true` e nenhuma linha nova.
//
// LGPD: nunca logar descrição, valor individual, agência ou conta. O log
// (`logEvent`, whitelist) carrega só `tenant_id`, `statement_id`, contagem e
// código. A resposta também não devolve o conteúdo do arquivo.

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
import { parseStatement, StatementParseError } from "./parser.ts";
import { requestSchema } from "./schemas.ts";

export type HandlerOptions = { createService: () => SupabaseClient };

interface ImportOutcome {
  statement_id: string;
  linhas_total: number;
  periodo_ini: string;
  periodo_fim: string;
  saldo_ini_cents: number | null;
  saldo_fim_cents: number | null;
  replayed: boolean;
}

function toOutcome(raw: unknown): ImportOutcome {
  const record = (raw ?? {}) as Record<string, unknown>;
  const statementId = record.statement_id;
  if (typeof statementId !== "string" || statementId === "") {
    throw new ApiError(500, "INTERNAL");
  }
  return {
    statement_id: statementId,
    linhas_total: Number(record.linhas_total ?? 0),
    periodo_ini: String(record.periodo_ini ?? ""),
    periodo_fim: String(record.periodo_fim ?? ""),
    saldo_ini_cents:
      record.saldo_ini_cents === null || record.saldo_ini_cents === undefined
        ? null
        : Number(record.saldo_ini_cents),
    saldo_fim_cents:
      record.saldo_fim_cents === null || record.saldo_fim_cents === undefined
        ? null
        : Number(record.saldo_fim_cents),
    replayed: record.replayed === true,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertAccount(service: SupabaseClient, tenantId: string, accountId: string): Promise<void> {
  const { data, error } = await service
    .from("bank_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data) throw new ApiError(404, "BANK_ACCOUNT_NOT_FOUND");
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

      // Entitlement server-side (ADR-08): plano sem `conciliacao` não importa.
      const feature = await service.rpc("tenant_has_feature", {
        p_tenant_id: identity.tenantId,
        p_feature: "conciliacao",
      });
      if (feature.error) throw new ApiError(500, "INTERNAL");
      if (feature.data !== true) throw new ApiError(403, "FEATURE_DISABLED");

      await assertAccount(service, identity.tenantId, body.account_id);

      let statement;
      try {
        statement = parseStatement(body.formato, body.conteudo);
      } catch (error) {
        if (error instanceof StatementParseError) {
          logEvent("statement_import_rejected", {
            tenant_id: identity.tenantId,
            actor_id: identity.userId,
            code: error.code,
          });
          // 422: arquivo ilegível é erro de negócio, não falha interna.
          throw new ApiError(422, error.code);
        }
        throw error;
      }

      const hash = await sha256Hex(`${body.formato}\n${body.conteudo.trim()}`);

      const { data, error } = await service.rpc("reconciliation_statement_create", {
        p_tenant_id: identity.tenantId,
        p_account_id: body.account_id,
        p_formato: body.formato,
        p_nome_arquivo: body.nome_arquivo,
        p_arquivo_hash: hash,
        p_periodo_ini: statement.periodo_ini,
        p_periodo_fim: statement.periodo_fim,
        p_saldo_ini_cents: statement.saldo_ini_cents,
        p_saldo_fim_cents: statement.saldo_fim_cents,
        p_linhas: statement.lines,
        p_importado_por: identity.userId,
      });
      if (error) throw mapRpcError(error);

      const outcome = toOutcome(data);
      logEvent("statement_imported", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        statement_id: outcome.statement_id,
        line_count: outcome.linhas_total,
        replayed: outcome.replayed,
      });

      return jsonResponse(outcome, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
