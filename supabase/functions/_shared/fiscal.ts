// Contrato fiscal compartilhado das Edges (ADR-02 + ADR-03).
// Somente tipos/validação de entrada (zod) + interface do provedor — sem
// credenciais: a chave privada do emissor e o token do fisco ficam em secrets
// do Supabase e só o emissor os lê. Este módulo nunca monta XML nem importa
// material sigiloso.
import { z } from "npm:zod@3.23.8";

export const FISCAL_ORIGIN_TYPES = ["appointment", "sale"] as const;

export const FISCAL_STATUSES = [
  "pendente",
  "autorizada",
  "contingencia",
  "rejeitada",
  "cancelada",
] as const;

export const FISCAL_EVENT_TYPES = [
  "emissao",
  "contingencia",
  "rejeicao",
  "cancelamento",
  "carta",
] as const;

/** Origem fiscal: 1 NFCe por (tenant, origem) — idempotência vem do unique. */
export const FiscalOrigemSchema = z.object({
  origem_tipo: z.enum(FISCAL_ORIGIN_TYPES),
  origem_id: z.string().uuid(),
  valor_cents: z.number().int().positive(),
});

export type FiscalOrigem = z.infer<typeof FiscalOrigemSchema>;

/** Chave de acesso da NFCe: 44 dígitos, só existe pós-autorização (nullable). */
export const ChaveAcessoSchema = z
  .string()
  .regex(/^\d{44}$/, "chave de acesso deve ter 44 dígitos");

export const FiscalStatusSchema = z.enum(FISCAL_STATUSES);

export const FiscalEventTypeSchema = z.enum(FISCAL_EVENT_TYPES);

/** CPF/CNPJ do destinatário: só dígitos, 11 (CPF) ou 14 (CNPJ). */
export const DestinatarioDocumentoSchema = z
  .string()
  .regex(/^\d{11}$|^\d{14}$/, "documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos");

/** Emissão (ADR-03 RF-02): origem + valor snapshot + documento do destinatário. */
export const IssueNfceRequestSchema = z
  .object({
    origem_tipo: z.enum(FISCAL_ORIGIN_TYPES),
    origem_id: z.string().uuid(),
    valor_cents: z.number().int().positive(),
    destinatario_documento: DestinatarioDocumentoSchema.optional(),
  })
  .strict();

export type IssueNfceRequest = z.infer<typeof IssueNfceRequestSchema>;

/**
 * Cancelamento (ADR-03 RF-04): só documento `autorizada`, motivo auditável
 * obrigatório (mínimo 15 caracteres — sem "teste"/vazio), XML/DANFE preservados
 * (a Edge nunca apaga `xml`/`danfe_url`; só transiciona o status + evento).
 */
export const CancelNfceRequestSchema = z
  .object({
    fiscal_document_id: z.string().uuid(),
    motivo: z.string().trim().min(15, "motivo do cancelamento deve ter ao menos 15 caracteres").max(500),
  })
  .strict();

export type CancelNfceRequest = z.infer<typeof CancelNfceRequestSchema>;

/** Carta de correção (ADR-03 RF-04): mesmo rigor de motivo do cancelamento. */
export const CartaNfceRequestSchema = z
  .object({
    fiscal_document_id: z.string().uuid(),
    motivo: z.string().trim().min(15, "texto da carta deve ter ao menos 15 caracteres").max(1000),
  })
  .strict();

export type CartaNfceRequest = z.infer<typeof CartaNfceRequestSchema>;

/** Resultado normalizado de qualquer provedor fiscal (SEFAZ direta ou não). */
export interface FiscalAuthorization {
  status: "autorizada" | "contingencia" | "rejeitada";
  numero: string | null;
  serie: string | null;
  chave_acesso: string | null;
  xml: string | null;
  motivo: string | null;
}

/**
 * Provedor-abstração fiscal (ADR-03, decisão PRD §10.1): a Edge `issue-nfce`
 * autoriza por esta interface; a v1 usa o stub auditado abaixo. Trocar pelo
 * provedor/SEFAZ real não muda schema, tabelas nem UI.
 */
export interface FiscalProvider {
  authorize(input: {
    tenantId: string;
    origemTipo: string;
    origemId: string;
    valorCents: number;
  }): Promise<FiscalAuthorization>;
  cancel(input: { fiscalDocumentId: string; motivo: string }): Promise<void>;
  correct(input: { fiscalDocumentId: string; texto: string }): Promise<void>;
}

/**
 * Stub auditado v1 (decisão ADR-03): não autoriza de verdade — grava
 * `pendente → autorizada|contingencia|rejeitada` + `fiscal_events` atrás de
 * feature/env, sem certificado no repo. Débito explícito: `TODO fiscal provider
 * real` (PRD §10.1). O modo vem de `FISCAL_STUB_RESULT` (`autorizada` default,
 * `contingencia` ou `rejeitada` para exercitar os estados sem SEFAZ).
 */
export function createStubFiscalProvider(): FiscalProvider {
  return {
    async authorize(input): Promise<FiscalAuthorization> {
      // TODO fiscal provider real (PRD §10.1): trocar o stub por provedor/SEFAZ
      // sem mudar schema, tabelas ou UI (interface `FiscalProvider` estável).
      const modo = (() => {
        try {
          return Deno.env.get("FISCAL_STUB_RESULT") ?? "autorizada";
        } catch {
          return "autorizada";
        }
      })();
      if (modo === "contingencia") {
        return {
          status: "contingencia",
          numero: null,
          serie: "1",
          chave_acesso: null,
          xml: null,
          motivo: "SEFAZ indisponível (stub): documento em contingência, sem valor fiscal.",
        };
      }
      if (modo === "rejeitada") {
        return {
          status: "rejeitada",
          numero: null,
          serie: "1",
          chave_acesso: null,
          xml: null,
          motivo: "Rejeição simulada pelo stub (cadastro destinatário).",
        };
      }
      return {
        status: "autorizada",
        numero: gerarNumeroStub(input.origemId),
        serie: "1",
        chave_acesso: gerarChaveStub(input.tenantId, input.origemId),
        xml: `<nfeProc versao="4.00"><chave>${gerarChaveStub(input.tenantId, input.origemId)}</chave></nfeProc>`,
        motivo: null,
      };
    },
    async cancel(_input): Promise<void> {
      return;
    },
    async correct(_input): Promise<void> {
      return;
    },
  };
}

/** Número fiscal determinístico por origem (estável no replay idempotente). */
function gerarNumeroStub(origemId: string): string {
  let hash = 0;
  for (const ch of origemId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return String(100000 + (hash % 899999));
}

/** Chave de 44 dígitos determinística por (tenant, origem) — só stub/teste. */
function gerarChaveStub(tenantId: string, origemId: string): string {
  const base = `${tenantId}${origemId}`.replace(/[^0-9]/g, "");
  const digitos = (base + "1234567890".repeat(5)).slice(0, 44);
  return digitos.padEnd(44, "0").slice(0, 44);
}
