import { useState } from "react"
import { AlertTriangle, Download, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { SectionHeading, SettingRow, SettingsCard } from "./settings-primitives"

interface DangerAction {
  id: string
  title: string
  description: string
  consequence: string
  confirmPhrase: string
  buttonLabel: string
}

const DANGER_ACTIONS: DangerAction[] = [
  {
    id: "reset",
    title: "Redefinir configurações",
    description: "Restaura todas as configurações para os valores padrão do sistema.",
    consequence: "Perfis, integrações e preferências voltam ao padrão. Dados financeiros não são afetados.",
    confirmPhrase: "REDEFINIR",
    buttonLabel: "Redefinir",
  },
  {
    id: "delete",
    title: "Excluir workspace",
    description: "Remove permanentemente o workspace e todos os seus dados.",
    consequence: "Transações, contas, cartões, notas e usuários serão apagados de forma irreversível em 30 dias.",
    confirmPhrase: "EXCLUIR WORKSPACE",
    buttonLabel: "Excluir workspace",
  },
]

export function AdvancedSection({ onReset }: { onReset: () => void }) {
  const [pending, setPending] = useState<DangerAction | null>(null)
  const [typed, setTyped] = useState("")

  const close = () => {
    setPending(null)
    setTyped("")
  }

  const confirm = () => {
    if (!pending) return
    if (pending.id === "reset") {
      onReset()
      toast.success("Configurações redefinidas para o padrão.")
    } else {
      toast.error("Exclusão agendada (simulação). Você tem 30 dias para cancelar.")
    }
    close()
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Avançado" description="Exportação de dados e ações irreversíveis." />

      <SettingsCard title="Seus dados" description="Conforme a LGPD, você pode exportar tudo a qualquer momento.">
        <SettingRow label="Exportar todos os dados" hint="Gera um arquivo ZIP com CSV/JSON e envia por e-mail." htmlFor="export">
          <Button id="export" type="button" variant="outline" size="sm" className="h-9 w-full gap-1.5 text-xs sm:w-auto" onClick={() => toast.success("Exportação solicitada. Você receberá um e-mail.")}>
            <Download className="size-3.5" /> Solicitar exportação
          </Button>
        </SettingRow>
      </SettingsCard>

      <section className="overflow-hidden rounded-xl border border-destructive/40 bg-destructive/5">
        <header className="flex items-center gap-2 border-b border-destructive/30 px-4 py-3 sm:px-5">
          <AlertTriangle className="size-4 text-destructive" />
          <h3 className="text-sm font-semibold text-destructive">Zona de perigo</h3>
        </header>
        <div className="divide-y divide-destructive/20">
          {DANGER_ACTIONS.map((a) => (
            <div key={a.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{a.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{a.description}</p>
              </div>
              <Button type="button" variant="destructive" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={() => setPending(a)}>
                <Trash2 className="size-3.5" /> {a.buttonLabel}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="w-full max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:max-w-[480px] sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-destructive">
              <AlertTriangle className="size-4" /> {pending?.title}
            </DialogTitle>
            <DialogDescription className="text-xs">{pending?.consequence}</DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="confirmPhrase" className="text-xs font-medium text-foreground">
              Digite <span className="font-mono font-bold text-destructive">{pending?.confirmPhrase}</span> para confirmar
            </label>
            <Input id="confirmPhrase" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-10 w-full font-mono text-xs" />
          </div>
          <DialogFooter className="mt-2 flex flex-row items-center justify-end gap-3 sm:space-x-0">
            <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
            <Button type="button" variant="destructive" disabled={typed !== pending?.confirmPhrase} onClick={confirm}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

