// Edge `export-ledger` (Fase 5 ADR-10; RF-36..38 + PRD §6.8/§7).
//
// Fronteira: admin-only (JWT → profile), entitlement `export_contabil`
// server-side e `tenant_id` SEMPRE do JWT. O arquivo é montado aqui e
// devolvido como download; nada é enviado para storage neste MVP.
//
// Regras:
//  * período vazio ⇒ 422 EMPTY_PERIOD, NENHUM arquivo e NENHUM log de sucesso
//    (só `audit_log` via `export_log_reject`). Log de entrega só existe quando
//    houve entrega.
//  * o log (`export_log_write`) é gravado ANTES da resposta: se o log falhar,
//    o cliente recebe 500 e não recebe arquivo sem prova.
//  * CSV com neutralização de fórmula (CWE-1236); OFX/SPED puros e
//    determinísticos; nenhum segredo vai ao corpo nem ao log.
//  * `escopo` filtra CSV/SPED. OFX exporta o extrato conciliado do período
//    (ADR-10 §Decisão) — a UI avisa.

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
import { assertRange, dataNoFuso, loadPayload, readTenantTimezone } from "./data.ts";
import { buildCsv, fiscalToMovimentos } from "./csv.ts";
import { buildOfx } from "./ofx.ts";
import { agregarCategorias, agregarFiscal, buildSped } from "./sped.ts";
import { requestSchema } from "./schemas.ts";
import type { Escopo, Formato, Payload } from "./types.ts";

export type HandlerOptions = { createService: () => SupabaseClient };

const CONTENT_TYPE: Record<Formato, string> = {
  csv: "text/csv; charset=utf-8",
  ofx: "application/x-ofx; charset=utf-8",
  sped: "text/plain; charset=utf-8",
};

const EXTENSAO: Record<Formato, string> = { csv: "csv", ofx: "ofx", sped: "txt" };

/** Nome estável do arquivo entregue (também vira `arquivo_path` no log). */
export function exportFileName(
  formato: Formato,
  escopo: Escopo,
  periodoIni: string,
  periodoFim: string,
): string {
  return `export-${escopo}-${formato}-${periodoIni}_${periodoFim}.${EXTENSAO[formato]}`;
}

/** Tipo registrado em `export_logs` (a coluna é text; não há enum novo). */
export function exportLogTipo(formato: Formato, escopo: Escopo): string {
  if (formato === "ofx") return "ofx";
  if (formato === "sped") return "sped";
  if (escopo === "pagar") return "payables";
  if (escopo === "fiscal") return "fiscal";
  return "ledger";
}

/**
 * OFX com conta configurada e zero movimentos NÃO é período vazio: o extrato
 * tem saldo de abertura/fechamento e é um arquivo válido. Vazio é não haver
 * conta ativa para emitir o extrato.
 */
function isEmpty(payload: Payload, formato: Formato): boolean {
  if (formato === "ofx") return payload.bankMeta === null;
  return payload.movimentos.length === 0 && payload.fiscal.length === 0;
}

function render(
  formato: Formato,
  escopo: Escopo,
  payload: Payload,
  periodo: string,
  periodoIni: string,
  periodoFim: string,
  generatedAt: Date,
): { body: string; linhas: number } {
  if (formato === "ofx") {
    const body = buildOfx({
      periodoIni,
      periodoFim,
      lines: payload.bankLines,
      openingCents: payload.saldoAberturaCents,
      meta: payload.bankMeta,
      generatedAt,
    });
    return { body, linhas: payload.bankLines.length };
  }

  if (formato === "sped") {
    const categorias =
      escopo === "fiscal" ? agregarFiscal(payload.fiscal) : agregarCategorias(payload.movimentos);
    const totalCents = categorias.reduce((total, categoria) => total + categoria.total_cents, 0);
    const totalCount =
      escopo === "fiscal" ? payload.fiscal.length : payload.movimentos.length;
    const body = buildSped({
      periodo,
      escopo,
      categorias,
      totalCents,
      totalCount,
    });
    return { body, linhas: totalCount };
  }

  const rows =
    escopo === "fiscal" ? fiscalToMovimentos(payload.fiscal) : payload.movimentos;
  return { body: buildCsv(rows), linhas: rows.length };
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

      // Bordas UTC validadas ANTES de qualquer leitura (range e ordem).
      assertRange(body.ini, body.fim);

      // Entitlement server-side (ADR-10): plano sem `export_contabil` não lê
      // nenhuma tabela financeira.
      const feature = await service.rpc("tenant_has_feature", {
        p_tenant_id: identity.tenantId,
        p_feature: "export_contabil",
      });
      if (feature.error) throw new ApiError(500, "INTERNAL");
      if (feature.data !== true) throw new ApiError(403, "FEATURE_DISABLED");

      const timeZone = await readTenantTimezone(service, identity.tenantId);

      // Os rótulos do período NÃO são fonte da verdade: derivamos das bordas
      // UTC no fuso do tenant e recusamos divergência. Sem isso o log poderia
      // registrar um período diferente do que foi lido (o arquivo diria uma
      // janela, o log outra).
      const periodoIni = dataNoFuso(body.ini, timeZone);
      const periodoFim = dataNoFuso(new Date(Date.parse(body.fim) - 1).toISOString(), timeZone);
      if (periodoIni !== body.periodo_ini || periodoFim !== body.periodo_fim) {
        throw new ApiError(400, "INVALID_BODY");
      }

      const payload = await loadPayload(service, {
        tenantId: identity.tenantId,
        ini: body.ini,
        fim: body.fim,
        periodoIni,
        periodoFim,
        formato: body.formato,
        escopo: body.escopo,
        timeZone,
      });

      const periodo = `${periodoIni}..${periodoFim}`;

      if (isEmpty(payload, body.formato)) {
        // Recusa é auditada em `audit_log`, nunca em `export_logs`.
        try {
          const rejected = await service.rpc("export_log_reject", {
            p_tenant_id: identity.tenantId,
            p_periodo: periodo,
            p_formato: body.formato,
            p_escopo: body.escopo,
            p_motivo: "EMPTY_PERIOD",
            p_actor_id: identity.userId,
          });
          if (rejected.error) {
            logEvent("export_reject_log_failed", {
              tenant_id: identity.tenantId,
              code: "INTERNAL",
            });
          }
        } catch {
          logEvent("export_reject_log_failed", {
            tenant_id: identity.tenantId,
            code: "INTERNAL",
          });
        }
        throw new ApiError(422, "EMPTY_PERIOD");
      }

      const generatedAt = new Date();
      const { body: content, linhas } = render(
        body.formato,
        body.escopo,
        payload,
        periodo,
        periodoIni,
        periodoFim,
        generatedAt,
      );

      const fileName = exportFileName(body.formato, body.escopo, periodoIni, periodoFim);
      const tipo = exportLogTipo(body.formato, body.escopo);

      const logged = await service.rpc("export_log_write", {
        p_tenant_id: identity.tenantId,
        p_tipo: tipo,
        p_periodo: periodo,
        p_formato: body.formato,
        p_arquivo_path: fileName,
        p_actor_id: identity.userId,
        p_escopo: body.escopo,
      });
      if (logged.error) throw mapRpcError(logged.error);

      const record = (logged.data ?? {}) as Record<string, unknown>;
      const logId = typeof record.id === "string" ? record.id : "";

      logEvent("export_generated", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        formato: body.formato,
        escopo: body.escopo,
        line_count: linhas,
        export_log_id: logId,
      });

      // BOM só no CSV (Excel pt-BR); OFX e SPED ficam ASCII/UTF-8 puros.
      const payloadBody = body.formato === "csv" ? `\uFEFF${content}` : content;

      return new Response(payloadBody, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": CONTENT_TYPE[body.formato],
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
          "Access-Control-Expose-Headers": "Content-Disposition, X-Export-Log-Id",
          ...(logId === "" ? {} : { "X-Export-Log-Id": logId }),
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

