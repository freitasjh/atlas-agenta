import { z } from "zod";

/**
 * Contas a receber (Fase 5 ADR-07). Tipos + metas + helpers puros da UI
 * (`/app/financeiro/receber`). Dinheiro em `*_cents`; tempo em timestamptz UTC.
 *
 * Fronteira: a aba Atendimentos lê o ledger `appointment_payments` (SSoT de
 * receita, somente leitura); a aba Avulsas lê `receivables`/`receivable_settlements`
 * e NUNCA escreve no ledger.
 */

export const RECEBIVEL_STATUSES = ["pendente", "parcial", "pago", "cancelado"] as const;
export type RecebivelStatus = (typeof RECEBIVEL_STATUSES)[number];

export function isRecebivelStatus(raw: unknown): raw is RecebivelStatus {
  return typeof raw === "string" && (RECEBIVEL_STATUSES as readonly string[]).includes(raw);
}

/** Métodos aceitos no recebimento manual (espelham o CHECK da migration). */
export const RECEBIMENTO_METODOS = [
  "dinheiro",
  "pix",
  "cartao_credito",
  "cartao_debito",
  "transferencia",
] as const;
export type RecebimentoMetodo = (typeof RECEBIMENTO_METODOS)[number];

export const RECEBIMENTO_METODO_META: Record<RecebimentoMetodo, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  transferencia: "Transferência",
};

export interface Receivable {
  id: string;
  tenant_id: string;
  customer_id: string;
  descricao: string;
  categoria: string;
  vencimento_at: string;
  valor_cents: number;
  status: RecebivelStatus;
  asaas_payment_id: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  charge_expires_at: string | null;
  created_at: string;
  /**
   * Soma dos recebimentos da conta, agregada pelo banco (`receivable_list`).
   * Nunca recalcular em memória sobre uma janela limitada de settlements.
   */
  recebido_cents: number;
}

/** Linha readonly do ledger de atendimento (`receivable_ledger_list`). */
export interface ReceivableLedgerEntry {
  id: string;
  appointment_id: string;
  method: string;
  amount_cents: number;
  tip_cents: number;
  source: string;
  received_at: string;
  customer_name: string | null;
  service_name: string | null;
}

export const RECEBIVEL_STATUS_META: Record<
  RecebivelStatus,
  { rotulo: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pendente: { rotulo: "Pendente", variant: "secondary" },
  parcial: { rotulo: "Parcial", variant: "default" },
  pago: { rotulo: "Quitado", variant: "outline" },
  cancelado: { rotulo: "Cancelado", variant: "destructive" },
};

/** Saldo da conta: valor menos a soma dos recebimentos (nunca negativo). */
export function restoReceivable(valorCents: number, recebidoCents: number): number {
  const valor = Number.isFinite(valorCents) ? valorCents : 0;
  const recebido = Number.isFinite(recebidoCents) ? recebidoCents : 0;
  return Math.max(0, valor - recebido);
}

/** Progresso do recebimento em % (0–100), para a barra pago vs total. */
export function progressoRecebido(valorCents: number, recebidoCents: number): number {
  if (!Number.isFinite(valorCents) || valorCents <= 0) return 0;
  const recebido = Number.isFinite(recebidoCents) ? recebidoCents : 0;
  return Math.min(100, Math.max(0, Math.round((recebido / valorCents) * 100)));
}

/**
 * "Vencida" é estado DERIVADO (ADR-07): `pendente` com vencimento no passado.
 * Nunca é coluna — evita cron e mantém o histórico sem UPDATE em massa.
 */
export function receivableVencida(
  receivable: Pick<Receivable, "status" | "vencimento_at">,
  agora: Date = new Date(),
): boolean {
  if (receivable.status !== "pendente") return false;
  const vencimento = new Date(receivable.vencimento_at);
  if (Number.isNaN(vencimento.getTime())) return false;
  return vencimento.getTime() < agora.getTime();
}

/** PIX vivo: enquanto existir, baixa manual e cancelamento da conta são bloqueados. */
export function receivableHasActiveCharge(receivable: Pick<Receivable, "asaas_payment_id">): boolean {
  return receivable.asaas_payment_id !== null;
}

/** PIX passou da validade e precisa ser cancelado/reemitido no gateway. */
export function receivableChargeExpired(
  receivable: Pick<Receivable, "charge_expires_at">,
  agora: Date = new Date(),
): boolean {
  if (!receivable.charge_expires_at) return false;
  const expira = new Date(receivable.charge_expires_at);
  if (Number.isNaN(expira.getTime())) return false;
  return expira.getTime() <= agora.getTime();
}

/**
 * Códigos de erro da RPC/Edge em pt-BR. A RPC levanta `message = CODE`, então sem
 * este mapa a UI mostraria o código cru (ex.: `RECEIVABLE_OVERPAY`).
 */
const RECEBER_ERROR_MESSAGES: Record<string, string> = {
  RECEIVABLE_NOT_FOUND: "Conta a receber não encontrada.",
  RECEIVABLE_ALREADY_PAID: "Esta conta já está quitada.",
  RECEIVABLE_CANCELLED: "Esta conta está cancelada.",
  RECEIVABLE_OVERPAY: "O valor informado é maior que o saldo da conta.",
  RECEIVABLE_HAS_SETTLEMENTS: "Conta com recebimento registrado não pode ser cancelada.",
  RECEIVABLE_HAS_ACTIVE_CHARGE:
    "Esta conta tem um PIX em aberto. Cancele o PIX antes de registrar recebimento ou cancelar a conta.",
  RECEIVABLE_NO_ACTIVE_CHARGE: "Esta conta não tem PIX em aberto.",
  RECEIVABLE_CHARGE_CHANGED:
    "A cobrança mudou durante o cancelamento. Recarregue a página e tente novamente.",
  RECEIVABLE_CHARGE_NOT_PENDING:
    "Cobrança PIX disponível apenas para conta pendente, sem recebimento parcial.",
  CUSTOMER_NOT_FOUND: "Cliente não encontrado.",
  FORBIDDEN: "Sem permissão para esta operação.",
  INVALID_BODY: "Dados inválidos.",
  WHATSAPP_OPT_IN_REQUIRED:
    "Cliente sem consentimento de WhatsApp (opt-in). Registre o consentimento antes de cobrar.",
  ASAAS_NOT_CONFIGURED: "Asaas não configurado para esta empresa.",
  GATEWAY_ERROR: "Falha ao criar a cobrança no gateway.",
  GATEWAY_CANCEL_FAILED: "Falha ao cancelar o PIX no gateway. A cobrança continua ativa.",
  GATEWAY_IN_PROGRESS: "A cobrança já está sendo criada. Tente novamente em instantes.",
};

/** Traduz o erro cru (código estável ou mensagem) para pt-BR legível. */
export function receivableErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  const byCode = RECEBER_ERROR_MESSAGES[trimmed];
  if (byCode) return byCode;
  // Códigos estáveis são MAIÚSCULOS com underscore; mensagens humanas passam direto.
  if (/^[A-Z][A-Z0-9_]{2,63}$/.test(trimmed)) return fallback;
  return trimmed;
}

export const novaAvulsaSchema = z.object({
  customer_id: z.string().uuid("Selecione o cliente."),
  descricao: z.string().trim().min(1, "Informe a descrição.").max(200),
  categoria: z.string().trim().max(60).optional().default("avulsa"),
  vencimento: z.string().trim().min(1, "Informe o vencimento."),
  valorReais: z.string().trim().min(1, "Informe o valor."),
});
export type NovaAvulsaInput = z.infer<typeof novaAvulsaSchema>;

export const recebimentoSchema = z.object({
  valorReais: z.string().trim().min(1, "Informe o valor recebido."),
  recebidoEm: z.string().trim().min(1, "Informe a data do recebimento."),
  metodo: z.enum(RECEBIMENTO_METODOS).default("pix"),
});
export type RecebimentoInput = z.infer<typeof recebimentoSchema>;

/** Resposta validada da Edge `create-receivable-charge`. */
export const cobrancaResponseSchema = z.object({
  receivable_id: z.string(),
  status: z.string(),
  amount_cents: z.number().int(),
  pix_qr_code: z.string().nullable(),
  pix_copy_paste: z.string().nullable(),
  expires_at: z.string().nullable(),
  reused: z.boolean(),
  whatsapp: z
    .object({
      requested: z.boolean(),
      queued: z.boolean(),
      message_id: z.string().nullable(),
    })
    .nullable()
    .optional(),
});
export type CobrancaResponse = z.infer<typeof cobrancaResponseSchema>;

/** Resposta validada da Edge `cancel-receivable-charge`. */
export const cancelamentoCobrancaSchema = z.object({
  receivable_id: z.string(),
  status: z.string(),
  cancelled: z.boolean(),
});
export type CancelamentoCobranca = z.infer<typeof cancelamentoCobrancaSchema>;
