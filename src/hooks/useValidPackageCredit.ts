import { z } from "zod";

import { supabase } from "@/lib/supabase";

/**
 * Checagem sob demanda de crédito de pacote válido (Fase 2, anti-dupla-cobrança).
 *
 * O auto-vínculo do trigger (RF-12) invalida qualquer guard do frontend que leia
 * `appointments.package_credit_id` pré-concluir (sempre `null` na sessão do pacote):
 * antes de abrir o capture em modo `close`, a agenda pergunta ao servidor
 * (`get_package_balance`, SSoT) se existe crédito válido para o cliente+serviço.
 * Com crédito válido, conclui direto (o trigger consome); sem crédito, abre o
 * capture normal. Falha de rede fail-open para o capture (comportamento anterior).
 */

const balanceRowSchema = z.object({
  credit_id: z.string(),
  service_id: z.string(),
  total_sessions: z.number().int(),
  used_sessions: z.number().int(),
  remaining: z.number().int(),
  expires_at: z.string(),
  expired: z.boolean(),
  status: z.string(),
});

/** `true` quando há crédito válido (ativo, não vencido, com saldo) p/ o serviço. */
export async function hasValidPackageCredit(
  customerId: string | null,
  serviceId: string | null,
): Promise<boolean> {
  if (!customerId || !serviceId) return false;
  const { data, error } = await supabase.rpc("get_package_balance", {
    p_customer_id: customerId,
  });
  if (error) return false;
  const parsed = z.array(balanceRowSchema).safeParse(data);
  if (!parsed.success) return false;
  return parsed.data.some(
    (row) =>
      row.service_id === serviceId &&
      row.status === "active" &&
      row.expired === false &&
      row.remaining > 0,
  );
}
