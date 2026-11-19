import { z } from "zod";

/**
 * Form de suspensão/retomada de empresa no back-office (ADR-11, RF-33).
 *
 * O motivo é **obrigatório** aqui (o contrato da Edge `admin-subscription`
 * aceita motivo opcional; a ADR-11 endurece a operação de suspender/retomar).
 * A trilha é gravada por `admin_set_subscription_status` →
 * `subscription_status_changes` (autor = JWT, motivo = este campo).
 */
export const REASON_MAX_LENGTH = 280;

export const backofficeStatusFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Informe o motivo da operação.")
    .max(
      REASON_MAX_LENGTH,
      `O motivo deve ter no máximo ${REASON_MAX_LENGTH} caracteres.`,
    ),
});

export type BackofficeStatusFormValues = z.infer<
  typeof backofficeStatusFormSchema
>;
