import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

export interface InlineConfirmStepProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "default" | "destructive";
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Confirmação **dentro** do diálogo corrente (ADR-004 D6): nunca portal, nunca
 * conteúdo de Dialog. `role="group"` (não `alertdialog`) para não duplicar a
 * semântica modal. Foco inicial na ação segura (cancelar).
 */
export function InlineConfirmStep({
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  busy = false,
  children,
  onConfirm,
  onCancel,
  testId,
}: InlineConfirmStepProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-testid={testId ?? "inline-confirm"}
      className="space-y-3 rounded-md border border-border bg-card p-3"
    >
      <p id={titleId} className="font-medium text-foreground">
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {children}
      <form
        className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className="h-11 min-h-[44px]"
        >
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          variant={tone === "destructive" ? "destructive" : "default"}
          disabled={busy}
          className="h-11 min-h-[44px]"
        >
          {confirmLabel}
        </Button>
      </form>
    </div>
  );
}
