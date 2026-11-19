import { Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BulkTransitionResult } from "@/app/agenda/useBulkTransition";

interface BulkActionBarProps {
  selectedCount: number;
  /** RBAC: `false` oculta a barra (defesa de UI; a trava real é o RLS). */
  canManage: boolean;
  running: boolean;
  progress: { done: number; total: number } | null;
  result: BulkTransitionResult | null;
  onConfirm: () => void;
  /** Cancelar exige confirmação única (diálogo) — nunca dispara direto. */
  onCancelRequest: () => void;
  onRetry: () => void;
  onClear: () => void;
}

/**
 * Barra de lote da Lista (ADR-04): Confirmar N direto, Cancelar N via
 * confirmação única, progresso com `progressbar`, resumo parcial em
 * `aria-live` com retry só dos falhados. Só oferece ações não financeiras —
 * receptionist incluído (R2). Sem Desfazer: o lote é irreversível
 * (`confirmado` não volta a `pendente`, `cancelado` é final).
 */
export function BulkActionBar({
  selectedCount,
  canManage,
  running,
  progress,
  result,
  onConfirm,
  onCancelRequest,
  onRetry,
  onClear,
}: BulkActionBarProps) {
  if (!canManage) return null;
  if (selectedCount === 0 && !running && !result) return null;

  const failedCount = result?.failed.length ?? 0;
  const okCount = result?.ok.length ?? 0;

  return (
    <section
      aria-label="Ações em lote"
      className="sticky top-0 z-10 space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium tabular-nums text-foreground">
          {selectedCount} selecionados
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {failedCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={running}
            >
              <RotateCcw aria-hidden="true" />
              Repetir {failedCount} com falha
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={running || selectedCount === 0}
          >
            {running ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            Confirmar {selectedCount} agendamentos
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onCancelRequest}
            disabled={running || selectedCount === 0}
          >
            Cancelar {selectedCount} agendamentos
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={running}
            aria-label="Limpar seleção do lote"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>

      {progress ? (
        <div
          role="progressbar"
          aria-label="Progresso do lote"
          aria-valuenow={progress.done}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-all",
              progress.total === 0 ? "w-0" : undefined,
            )}
            style={
              progress.total === 0
                ? undefined
                : { width: `${(progress.done / progress.total) * 100}%` }
            }
          />
        </div>
      ) : null}

      {result ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {okCount} ok, {failedCount} falharam
        </p>
      ) : null}
    </section>
  );
}
