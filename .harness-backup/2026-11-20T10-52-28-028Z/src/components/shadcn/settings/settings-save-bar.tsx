import { Loader2, Save, Undo2 } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { cn } from "@/lib/cn"

interface SettingsSaveBarProps {
  visible: boolean
  changedCount: number
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}

/** Barra fixa de alterações não salvas (aparece só quando há mudanças). */
export function SettingsSaveBar({ visible, changedCount, saving, onSave, onDiscard }: SettingsSaveBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 transition-all duration-200",
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}
    >
      <div className="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-4 py-2.5 shadow-lg">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-amber-500" />
          <p className="truncate text-xs font-medium text-foreground">
            <span className="font-mono tabular-nums">{changedCount}</span>{" "}
            {changedCount === 1 ? "alteração não salva" : "alterações não salvas"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onDiscard} disabled={saving} tabIndex={visible ? 0 : -1}>
            <Undo2 className="size-3.5" /> Descartar
          </Button>
          <Button type="button" size="sm" className="h-8 gap-1.5 text-xs font-semibold" onClick={onSave} disabled={saving} tabIndex={visible ? 0 : -1}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Salvar alterações
          </Button>
        </div>
      </div>
    </div>
  )
}

