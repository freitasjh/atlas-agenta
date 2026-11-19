import { useCallback, useState } from "react";

import { isTransitionAllowed } from "@/lib/scheduling-status";
import type { AppointmentStatus } from "@/types/domain";

/**
 * Lote sem endpoint batch (ADR-04): executa N chamadas à mutação de status
 * existente **em sequência**, coletando o resultado por item (parcial
 * permitido). Sem backend novo, sem rota `/bulk`/`/batch`.
 *
 * - Alvos permitidos: `confirmado` e `cancelado` (ações não financeiras —
 *   receptionist incluído). `concluido` dispara cobrança/comissão e
 *   `nao_compareceu` exige confirmação individual: ambos recusados aqui.
 * - Sem persistência de motivo e sem chave de idempotência: a chamada do lote
 *   é só `{id, from, to}` — o mesmo contrato da mutação individual. O retry
 *   re-dispara só os itens falhados, nunca os já aplicados.
 * - Sem desfazer: as transições do lote são irreversíveis na máquina de
 *   estados (`confirmado` não volta a `pendente`; `cancelado` é final), então
 *   o lote não oferece undo — o diálogo de confirmação declara isso.
 */
export type BulkTargetStatus = "confirmado" | "cancelado";

const BULK_TARGETS: readonly BulkTargetStatus[] = ["confirmado", "cancelado"];

export interface BulkTransitionItem {
  id: string;
  from: AppointmentStatus;
}

/**
 * Chamada do lote: id + transição, sem motivo e sem chave — espelha 1:1 o
 * contrato de `useChangeAppointmentStatus().mutateAsync`.
 */
export interface BulkTransitionCall {
  id: string;
  from: AppointmentStatus;
  to: AppointmentStatus;
}

export interface BulkTransitionFailure {
  item: BulkTransitionItem;
  error: unknown;
}

export interface BulkTransitionResult {
  ok: BulkTransitionItem[];
  failed: BulkTransitionFailure[];
}

export interface BulkTransition {
  running: boolean;
  progress: { done: number; total: number } | null;
  result: BulkTransitionResult | null;
  run: (
    items: BulkTransitionItem[],
    to: BulkTargetStatus,
  ) => Promise<BulkTransitionResult>;
  retry: () => Promise<BulkTransitionResult | null>;
  reset: () => void;
}

export function useBulkTransition(
  mutate: (call: BulkTransitionCall) => Promise<unknown>,
): BulkTransition {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<BulkTransitionResult | null>(null);
  const [lastRun, setLastRun] = useState<{
    items: BulkTransitionItem[];
    to: BulkTargetStatus;
  } | null>(null);

  const run = useCallback(
    async (
      items: BulkTransitionItem[],
      to: BulkTargetStatus,
    ): Promise<BulkTransitionResult> => {
      if (!BULK_TARGETS.includes(to)) {
        throw new Error(
          `Ação em lote não permitida: "${to}". Use a confirmação individual.`,
        );
      }
      setRunning(true);
      setResult(null);
      setProgress({ done: 0, total: items.length });
      setLastRun({ items, to });

      const ok: BulkTransitionItem[] = [];
      const failed: BulkTransitionFailure[] = [];
      for (const item of items) {
        try {
          if (!isTransitionAllowed(item.from, to)) {
            throw { code: "check_violation" };
          }
          await mutate({ id: item.id, from: item.from, to });
          ok.push(item);
        } catch (error) {
          failed.push({ item, error });
        }
        setProgress({ done: ok.length + failed.length, total: items.length });
      }

      const summary = { ok, failed };
      setResult(summary);
      setRunning(false);
      return summary;
    },
    [mutate],
  );

  const retry = useCallback(async (): Promise<BulkTransitionResult | null> => {
    const failedItems = result?.failed.map((failure) => failure.item) ?? [];
    if (!lastRun || failedItems.length === 0) return null;
    const previousOk = result?.ok ?? [];
    const attempt = await run(failedItems, lastRun.to);
    const merged: BulkTransitionResult = {
      ok: [...previousOk, ...attempt.ok],
      failed: attempt.failed,
    };
    setResult(merged);
    return merged;
  }, [lastRun, result, run]);

  const reset = useCallback(() => {
    setLastRun(null);
    setRunning(false);
    setProgress(null);
    setResult(null);
  }, []);

  return { running, progress, result, run, retry, reset };
}
