// Reconciliação do `check` (débito P2 whatsapp-check-404) — lógica pura e testável.
//
// Decide a escrita na linha `whatsapp_instances` a partir do resultado da
// consulta à Evolution. Regras:
// - `state === "open"` → persistir `conectado` (+ `last_connected_at` no caller).
// - instância ausente no Evolution (404 tipado) → persistir `desconectado`
//   (fim do polling infinito da UI em `aguardando_qr`).
// - qualquer outra falha → sem escrita (best-effort, mantém a linha atual).
import type { ConnectionStateResult } from "./evolution-adapter.ts";
import { EvolutionInstanceNotFoundError } from "./evolution-adapter.ts";

export type CheckWrite = "conectado" | "desconectado" | null;

/** Decide a escrita do `check`. Pura: sem rede, sem banco, sem relógio. */
export function decideCheckWrite(
  realState: ConnectionStateResult | null,
  error: unknown,
): CheckWrite {
  if (error instanceof EvolutionInstanceNotFoundError) return "desconectado";
  if (realState?.state === "open") return "conectado";
  return null;
}
