import { z } from "zod";

/**
 * Contas a pagar (Fase 5 ADR-06). Tipos + metas + helpers puros da UI
 * (`/app/financeiro/pagar`). Dinheiro em `*_cents`; tempo em timestamptz UTC.
 */

export const PAYABLE_STATUSES = ["pendente", "parcial", "pago", "cancelado"] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export const PAYABLE_RECORRENCIAS = ["none", "mensal"] as const;
export type PayableRecorrencia = (typeof PAYABLE_RECORRENCIAS)[number];

export function isPayableStatus(raw: unknown): raw is PayableStatus {
  return typeof raw === "string" && (PAYABLE_STATUSES as readonly string[]).includes(raw);
}

export interface Supplier {
  id: string;
  tenant_id: string;
  nome: string;
  documento: string | null;
  contato: string | null;
  ativo: boolean;
  created_at: string;
}

export interface Payable {
  id: string;
  tenant_id: string;
  supplier_id: string | null;
  descricao: string;
  categoria: string | null;
  vencimento_at: string;
  valor_cents: number;
  status: PayableStatus;
  recorrencia: PayableRecorrencia;
  serie_id: string | null;
  created_at: string;
}

export interface PayableSettlement {
  id: string;
  tenant_id: string;
  payable_id: string;
  valor_cents: number;
  pago_at: string;
  conta: string | null;
  anexo_path: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PayableKpis {
  vencido_cents: number;
  vencido_count: number;
  proximos7d_cents: number;
  proximos7d_count: number;
}

export const PAYABLE_STATUS_META: Record<PayableStatus, { rotulo: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendente: { rotulo: "Pendente", variant: "secondary" },
  parcial: { rotulo: "Parcial", variant: "default" },
  pago: { rotulo: "Pago", variant: "outline" },
  cancelado: { rotulo: "Cancelado", variant: "destructive" },
};

/** Resto pendente da conta: valor menos a soma das baixas. */
export function restoPayable(valorCents: number, baixasCents: number): number {
  return Math.max(0, (Number.isFinite(valorCents) ? valorCents : 0) - (Number.isFinite(baixasCents) ? baixasCents : 0));
}

/** Anexo de baixa: 10MB, pdf/jpg/jpeg/png (MIME + extensão). Retorna a chave de erro ou `null`. */
export const ANEXO_EXTENSOES_PERMITIDAS = ["pdf", "jpg", "jpeg", "png"] as const;

const ANEXO_MIME_POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function extensaoAnexo(nome: string): string {
  const partes = nome.split(".");
  if (partes.length < 2) return "";
  return (partes.pop() ?? "").toLowerCase();
}

/** Content-Type canônico pela extensão (evita `File.type` vazio/adulterado no upload). */
export function contentTypeAnexo(nome: string, fallback: string): string {
  const ext = extensaoAnexo(nome);
  return ANEXO_MIME_POR_EXTENSAO[ext] ?? fallback;
}

export function validateAnexoFile(file: File): string | null {
  const ok = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
  if (!ok.includes(file.type)) return "tipo-arquivo-invalido";
  if (!(ANEXO_EXTENSOES_PERMITIDAS as readonly string[]).includes(extensaoAnexo(file.name))) {
    return "tipo-arquivo-invalido";
  }
  if (file.size > 10 * 1024 * 1024) return "arquivo-muito-grande";
  return null;
}

export function mapAnexoError(code: string): string {
  if (code === "tipo-arquivo-invalido") return "Anexo deve ser PDF, JPG ou PNG.";
  if (code === "arquivo-muito-grande") return "Anexo deve ter no máximo 10 MB.";
  return "Não foi possível enviar o anexo. Tente novamente.";
}

export const novoFornecedorSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome do fornecedor.").max(120),
  documento: z.string().trim().max(30).optional().default(""),
  contato: z.string().trim().max(120).optional().default(""),
});
export type NovoFornecedorInput = z.infer<typeof novoFornecedorSchema>;

export const novoLancamentoSchema = z.object({
  descricao: z.string().trim().min(1, "Informe a descrição.").max(200),
  categoria: z.string().trim().max(60).optional().default(""),
  supplier_id: z.string().uuid().nullable().optional().default(null),
  vencimento: z.string().trim().min(1, "Informe o vencimento."),
  valorReais: z.string().trim().min(1, "Informe o valor."),
  recorrencia: z.enum(PAYABLE_RECORRENCIAS).default("none"),
  parcelas: z.coerce.number().int().min(2).max(24).default(3),
});
export type NovoLancamentoInput = z.infer<typeof novoLancamentoSchema>;

export const baixaSchema = z.object({
  valorReais: z.string().trim().min(1, "Informe o valor da baixa."),
  pagoEm: z.string().trim().min(1, "Informe a data do pagamento."),
  conta: z.string().trim().max(60).optional().default(""),
});
export type BaixaInput = z.infer<typeof baixaSchema>;
