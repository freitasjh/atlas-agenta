import { z } from "zod";

/**
 * Validação da config de depósito/sinal por serviço (Fase 4, ADR-12).
 *
 * Espelha os CHECKs do banco (ADR-02): `deposit_type in ('percent','fixed')`,
 * `deposit_value >= 0` (% 0–100 ou centavos), `deposit_deadline_hours > 0`,
 * `deposit_refund_policy in ('total','partial','none')`,
 * `deposit_refund_percent between 0 and 100`. Mensagens em pt-BR.
 */

export const depositTypeSchema = z.enum(["percent", "fixed"], {
  errorMap: () => ({ message: "Escolha percentual ou valor fixo." }),
});

export type DepositType = z.infer<typeof depositTypeSchema>;

export const depositRefundPolicySchema = z.enum(["total", "partial", "none"], {
  errorMap: () => ({ message: "Escolha a política de reembolso." }),
});

export type DepositRefundPolicy = z.infer<typeof depositRefundPolicySchema>;

export const depositConfigSchema = z
  .object({
    enabled: z.boolean(),
    type: depositTypeSchema.nullable().default(null),
    value: z
      .number({ invalid_type_error: "Informe o valor do depósito." })
      .int("O valor do depósito deve ser um número inteiro.")
      .min(0, "O valor do depósito não pode ser negativo.")
      .default(0),
    deadlineHours: z
      .number({ invalid_type_error: "Informe o prazo em horas." })
      .int("O prazo deve ser um número inteiro de horas.")
      .positive("O prazo deve ser maior que zero.")
      .max(720, "O prazo deve ser de no máximo 720 horas (30 dias).")
      .default(24),
    refundPolicy: depositRefundPolicySchema.default("none"),
    refundPercent: z
      .number({ invalid_type_error: "Informe o percentual de reembolso." })
      .int("O percentual de reembolso deve ser um número inteiro.")
      .min(0, "O percentual de reembolso não pode ser negativo.")
      .max(100, "O percentual de reembolso deve ser de no máximo 100%.")
      .nullable()
      .default(null),
  })
  .superRefine((cfg, ctx) => {
    if (!cfg.enabled) return;
    if (cfg.type === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Escolha percentual ou valor fixo.",
        path: ["type"],
      });
    }
    if (cfg.type === "percent" && (cfg.value < 1 || cfg.value > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O percentual deve ser entre 1 e 100.",
        path: ["value"],
      });
    }
    if (cfg.type === "fixed" && cfg.value < 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O valor fixo mínimo é R$ 1,00.",
        path: ["value"],
      });
    }
    if (
      cfg.refundPolicy === "partial" &&
      (cfg.refundPercent === null ||
        cfg.refundPercent < 0 ||
        cfg.refundPercent > 100)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o percentual reembolsável (0 a 100).",
        path: ["refundPercent"],
      });
    }
  });

export type DepositConfigInput = z.infer<typeof depositConfigSchema>;

export const EMPTY_DEPOSIT_CONFIG: DepositConfigInput = {
  enabled: false,
  type: null,
  value: 0,
  deadlineHours: 24,
  refundPolicy: "none",
  refundPercent: null,
};

/**
 * Calcula o valor do depósito em centavos inteiros a partir do preço do
 * serviço. `percent` = % de `priceCents` (arredonda); `fixed` = valor direto.
 * Nunca usa float para persistir — o retorno é inteiro.
 */
export function calcDepositCents(
  priceCents: number,
  type: DepositType | null,
  value: number,
): number {
  if (!Number.isFinite(priceCents) || priceCents < 0) return 0;
  if (type === "percent") {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round((priceCents * Math.min(value, 100)) / 100);
  }
  if (type === "fixed") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }
  return 0;
}

/** Charge PIX vinculada ao atendimento (leitura sob RLS — sem PII). */
export interface DepositCharge {
  id: string;
  status: "pendente" | "pago" | "expirada" | "cancelada";
  amountCents: number;
  pixQrCode?: string | null;
  pixCopiaECola?: string | null;
  expiresAt?: string | null;
}
