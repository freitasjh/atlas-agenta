// Dedupe durável de `webhook_events`: insere ANTES do efeito com `processed_at = null`.
// `processed_at` é a única fonte de verdade; `status` é rótulo operacional.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type BeginEventResult = "process" | "already_processed";

export interface EventKey {
  tenantId: string;
  eventId: string;
  paymentId: string;
  eventType: string;
}

/**
 * Tenta reservar o evento.
 *  - insert OK ⇒ `process`;
 *  - `23505` + `processed_at` não nulo no par ⇒ `already_processed` (no-op);
 *  - `23505` + `processed_at` nulo no par ⇒ `process` (takeover de entrega anterior que falhou);
 *  - `23505` sem linha do par, mas com o mesmo `event_id` (índice legado `(source,
 *    external_event_id)`) ⇒ `already_processed`: a colisão é de dedupe, nunca takeover;
 *  - `23505` sem nenhuma linha ⇒ `process` (conflito transitório; nada foi processado);
 *  - qualquer outro erro ⇒ propaga (handler responde 500 sem processar).
 */
export async function beginEvent(
  service: SupabaseClient,
  key: EventKey,
): Promise<BeginEventResult> {
  const { error } = await service.from("webhook_events").insert({
    event_id: key.eventId,
    payment_id: key.paymentId,
    event_type: key.eventType,
    tenant_id: key.tenantId,
    source: "asaas",
    external_event_id: key.eventId,
    instance_name: "asaas",
    status: "recebido",
    processed_at: null,
    payload: {},
  });

  if (!error) return "process";
  if (error.code !== "23505") throw error;

  const { data, error: readError } = await service
    .from("webhook_events")
    .select("processed_at")
    .eq("event_id", key.eventId)
    .eq("payment_id", key.paymentId)
    .maybeSingle();
  if (readError) throw readError;
  if (data) return data.processed_at ? "already_processed" : "process";

  // O par `(event_id, payment_id)` não existe: a colisão veio do índice legado
  // `(source, external_event_id)`. Se o evento já está registrado, é duplicata.
  const { data: byEvent, error: eventReadError } = await service
    .from("webhook_events")
    .select("processed_at")
    .eq("event_id", key.eventId)
    .maybeSingle();
  if (eventReadError) throw eventReadError;
  if (byEvent) return "already_processed";

  return "process";
}

/** Marca o evento como processado. Falha aqui ⇒ handler responde 500 (retry é idempotente). */
export async function finishEvent(
  service: SupabaseClient,
  eventId: string,
  paymentId: string,
): Promise<void> {
  const { error } = await service
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString(), status: "processado" })
    .eq("event_id", eventId)
    .eq("payment_id", paymentId);
  if (error) throw error;
}
