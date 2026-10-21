// Schemas zod do payload de ENTRADA da Evolution — Edge Function `whatsapp-inbound` (ADR-03).
//
// Este é o PRIMEIRO webhook de ENTRADA do projeto: superfície pública (sem JWT de usuário) que
// recebe o POST da Evolution quando o cliente responde no WhatsApp. O corpo é DADO NÃO CONFIÁVEL
// (RNF-S2-03): validar com zod ANTES de usar, nunca executar conteúdo recebido. O schema é
// deliberadamente TOLERANTE — a Evolution evolui e campos variam entre versões; validamos só o
// mínimo necessário para o casamento (id do evento, instância, remetente, texto) e aceitamos o
// resto como opcional. O coder confirma os nomes exatos contra o servidor v2.3.7 no QA (ADR-07)
// e ajusta aqui se divergir.
//
// Formato aproximado do evento de mensagem recebida (Evolution v2.3.x, `messages.upsert` /
// `MESSAGES_UPSERT`), resumido das issues públicas do repositório EvolutionAPI/evolution-api
// (ex.: #572, #975). Content was rephrased for compliance with licensing restrictions.
//   {
//     event: "messages.upsert",
//     instance: "tenant-<uuid>",
//     data: {
//       key: { remoteJid: "5511...@s.whatsapp.net", fromMe: false, id: "<msgId>" },
//       message: { conversation?: "1", extendedTextMessage?: { text?: "1" } },
//       messageTimestamp?: 1710000000
//     }
//   }

import { z } from "npm:zod@3.23.8";

/**
 * `key` do evento: identifica a mensagem (dedupe), o remetente (`remoteJid`) e se é eco da
 * própria instância (`fromMe`). `id` é a CHAVE DE DEDUPE de entrada (external_event_id, R7).
 */
export const inboundKeySchema = z.object({
  id: z.string().min(1),
  remoteJid: z.string().min(1).optional(),
  fromMe: z.boolean().optional(),
});

/**
 * Corpo da mensagem. Tolerante: o texto pode vir em `conversation` (mensagem simples) ou em
 * `extendedTextMessage.text` (mensagem com contexto/resposta). Ambos opcionais — a função extrai
 * o primeiro disponível; ausência de texto é tratada como "nada a fazer" (ignorado).
 */
export const inboundMessageSchema = z
  .object({
    conversation: z.string().optional(),
    extendedTextMessage: z
      .object({ text: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** `data` do evento: `key` obrigatório (precisamos do `id` p/ dedupe); `message` opcional. */
export const inboundDataSchema = z
  .object({
    key: inboundKeySchema,
    message: inboundMessageSchema.optional(),
    messageTimestamp: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

/**
 * Payload completo do webhook. `instance` resolve o tenant (NUNCA do payload vem o tenant_id
 * direto — resolvemos `instance → tenant_id` no servidor). `data` carrega a mensagem. `.passthrough()`
 * em todos os níveis: campos extras da Evolution são ignorados, não rejeitados.
 */
export const inboundEventSchema = z
  .object({
    event: z.string().optional(),
    instance: z.string().min(1),
    data: inboundDataSchema,
  })
  .passthrough();

export type InboundEvent = z.infer<typeof inboundEventSchema>;
export type InboundKey = z.infer<typeof inboundKeySchema>;

/**
 * Extrai o texto da mensagem recebida, tolerando os dois formatos. Retorna `null` quando não há
 * texto (ex.: mídia, evento sem corpo) — o chamador trata como "nada a interpretar".
 */
export function extractInboundText(event: InboundEvent): string | null {
  const msg = event.data.message;
  if (!msg) return null;
  const text = msg.conversation ?? msg.extendedTextMessage?.text ?? null;
  if (text == null) return null;
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Extrai o número do remetente a partir de `remoteJid` (`55...@s.whatsapp.net` /
 * `...@c.us`): a parte antes de `@`. Retorna `null` se ausente ou se for grupo (`@g.us`), que
 * não é uma resposta individual de confirmação. NUNCA logar o número (PII — R19).
 */
export function extractSenderNumber(event: InboundEvent): string | null {
  const jid = event.data.key.remoteJid;
  if (!jid) return null;
  if (jid.endsWith("@g.us")) return null; // mensagem de grupo: fora de escopo
  const at = jid.indexOf("@");
  const raw = at === -1 ? jid : jid.slice(0, at);
  const cleaned = raw.trim();
  return cleaned === "" ? null : cleaned;
}

/**
 * Interpreta o texto como intenção numérica. Normaliza: trim + primeiro token (tolera
 * "1 confirmar", "2 reagendar"). `1` → confirmar; `2` → reagendar; qualquer outro →
 * não reconhecido (R11). Nunca persiste o texto cru (PII mínima).
 */
export type ParsedIntent = "confirmar" | "reagendar" | "nao_reconhecido";

export function parseIntent(text: string): ParsedIntent {
  const firstToken = text.trim().split(/\s+/)[0] ?? "";
  if (firstToken === "1") return "confirmar";
  if (firstToken === "2") return "reagendar";
  return "nao_reconhecido";
}
